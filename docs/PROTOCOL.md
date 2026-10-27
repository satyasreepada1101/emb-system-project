# WebSocket Protocol — Sound Direction Finder

Transport: WebSocket, text frames, one JSON object per frame.
Server: the ESP32 at `ws://<ESP32-IP>:81` (port `WEBSOCKET_PORT` in the firmware).
Clients: the dashboard (and `npm run protocol-check`). Up to 5 clients at once.

Frontend types: `frontend/src/types/protocol.ts` · validator: `frontend/src/services/protocolParser.ts`.

---

## ESP32 → browser

### `hello` (once, on connect)

```json
{
  "type": "hello",
  "device": "esp32",
  "firmware": "sound-direction-finder 1.0.0",
  "telemetryIntervalMs": 200,
  "servoMin": 10,
  "servoMax": 170,
  "micAngles": [0, 60, 120, 180]
}
```

`device` is `"esp32"` for real firmware and `"simulator"` for `scripts/mock-esp32.mjs`. The dashboard shows a
**MOCK SIMULATOR** warning for the latter.

### `telemetry` (every 200 ms, and immediately after any state change)

```json
{
  "type": "telemetry",
  "sequence": 100,
  "uptimeMs": 120000,
  "systemEnabled": true,
  "enableSource": "button",
  "calibrating": false,
  "calibrated": true,
  "calibrationProgress": 100,
  "soundDetected": true,
  "measurementCount": 231,
  "micActivity": [120, 420, 190, 110],
  "micThresholds": [180, 200, 180, 180],
  "micNoiseFloors": [70, 95, 80, 66],
  "estimatedAngle": 72.0,
  "smoothedAngle": 70.4,
  "strongestMic": 2,
  "servoTarget": 108,
  "led1On": true,
  "led2On": true,
  "rssi": -58
}
```

(All numbers are illustrative.)

| Field | Type | Unit / range | Meaning |
|---|---|---|---|
| `sequence` | int | ≥ 1 | Increments by 1 for every telemetry message the ESP32 produces. |
| `uptimeMs` | int | ms | ESP32 `millis()` (wraps after ~49 days). |
| `systemEnabled` | bool | | Detection system enabled. Same flag driven by the button and the website. |
| `enableSource` | string | `boot` \| `button` \| `web` | What last changed `systemEnabled`. |
| `calibrating` | bool | | Noise calibration (≈30 s, 150 windows) in progress. |
| `calibrated` | bool | | Calibration has completed; thresholds are valid. |
| `calibrationProgress` | int | 0–100 % | Calibration progress (100 once calibrated). |
| `soundDetected` | bool | | The **latest completed 500 ms listening interval** had at least one mic above its threshold (`estimateDirection()` returned true). Always `false` while disabled. |
| `measurementCount` | int | | Completed listening intervals since boot. |
| `micActivity` | int[4] \| null | ADC counts (12-bit, 0–4095) | Mic 1…Mic 4. Average of the peak-to-peak ADC values of the 20 ms windows in the latest 500 ms interval. These are the exact numbers the algorithm used. `null` while disabled, calibrating, or before the first interval. |
| `micThresholds` | int[4] \| null | ADC counts | Calibrated thresholds: `max(180, floor + max(100, floor × 0.35))`. `null` until calibrated. |
| `micNoiseFloors` | int[4] \| null | ADC counts | Calibrated median noise floor of each mic. `null` until calibrated. |
| `estimatedAngle` | number \| null | degrees, 0–180, 0.1 resolution | Interpolated direction of the latest interval (strongest mic angle, moved toward its stronger qualifying neighbour). `null` when there is no qualifying sound or the system is disabled. **This is the value the radar and Detected Direction panel display.** |
| `smoothedAngle` | number \| null | degrees, 0–180 | Exponentially smoothed direction (factor 0.35) after 2 consecutive detections; drives the servo. Persists between sounds; `null` before the first confirmed detection. |
| `strongestMic` | int \| null | 1–4 | Strongest qualifying mic (**1-based**: 1 = Mic 1 at 0°). `null` with no qualifying sound. |
| `servoTarget` | int | degrees, 10–170 | Last angle written to the servo (`180 − round(smoothedAngle)`, clamped). 90 at boot. Not updated while disabled. |
| `led1On` | bool | | **Commanded** logical state of LED 1 (system enabled). |
| `led2On` | bool | | **Commanded** logical state of LED 2 (sound detected and not calibrating). |
| `rssi` | int | dBm | Wi-Fi signal strength. |

`led1On`/`led2On` report what the firmware writes to the GPIO pins. They are not independently measured; a burnt
LED or wiring fault will not show up here.

### `commandAck` (reply to a command)

```json
{ "type": "commandAck", "commandId": "6c1d…", "accepted": true, "systemEnabled": false, "message": "System disabled" }
```

| Field | Meaning |
|---|---|
| `commandId` | Copied from the command. |
| `accepted` | `true` if the command was valid and applied (or the state was already as requested). |
| `systemEnabled` | Confirmed state **after** processing. |
| `message` | Human-readable outcome, e.g. `System disabled`, `System already enabled`, `Unsupported command type`. |

### `error`

```json
{ "type": "error", "message": "Malformed JSON: expected an object" }
```

Sent when a message cannot be associated with a `commandId` (invalid JSON, not an object, missing/invalid
`commandId`, empty or > 512 bytes).

---

## Browser → ESP32

### `setSystemEnabled`

```json
{ "type": "setSystemEnabled", "commandId": "6c1d6f0e-…", "enabled": false }
```

| Field | Rules |
|---|---|
| `commandId` | String, 1–64 chars, unique per command (UUID). |
| `enabled` | Boolean. **Sets** the state; it never toggles, so a retried or duplicated message cannot flip the state twice. |

Validation on the ESP32:

| Input | Response |
|---|---|
| Invalid JSON / not an object / bad `commandId` | `error` |
| `type` ≠ `setSystemEnabled` | `commandAck` with `accepted: false` |
| `enabled` not a boolean | `commandAck` with `accepted: false` |
| Valid | State applied via the same `setSystemEnabled()` used by the button → `commandAck` with `accepted: true` → immediate telemetry broadcast |

### Dashboard command rules

* One command at a time; the switch shows a spinner while pending.
* Success is shown **only** after a `commandAck` with the matching `commandId` and `accepted: true`.
* No ack within `VITE_COMMAND_TIMEOUT_MS` (3 s) → *timeout*; the UI keeps showing the last confirmed state.
* Connection lost while pending → *failed (effect unknown)*. Commands are **never** queued or resent after a reconnect.
* Late acks (after timeout) are ignored.
* The switch position always comes from telemetry/ack, so a physical button press is reflected on the next telemetry
  frame (≤ 200 ms), even during a pending command.

## Staleness

The dashboard marks telemetry **stale** after `VITE_TELEMETRY_STALE_MS` (default 1500 ms, editable in the UI) without
a frame. Stale or disconnected data is hidden from all live panels and the website control is disabled.
