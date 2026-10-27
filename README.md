# Sound Direction Finder

*Locate the direction of the sound source in real time.*

Embedded Systems project: an ESP32 estimates the direction (0°–180°) of a sound from the **amplitude** of four
MAX9814 microphones (not TDOA), points an SG90 servo at it, and streams live data over Wi-Fi to a radar-style web
dashboard. The dashboard can also switch the detection system on and off.

```
PC browser (React dashboard)  ⇄  Wi-Fi router  ⇄  ESP32 (WebSocket server, port 81)
                                                    ├─ 4 × MAX9814 (GPIO 32/33/34/35)
                                                    ├─ SG90 servo (GPIO 18)
                                                    ├─ LED 1 system (GPIO 25), LED 2 sound (GPIO 26)
                                                    └─ push button (GPIO 27 → GND)
```

## Project layout

```
PROJECT/
├── Mic_Test.ino.ino              original sketch (unchanged, kept as backup)
├── Demo display.jpeg             reference design
├── firmware/
│   ├── README.md                 wiring, libraries, behaviour, what changed
│   └── sound_direction_finder/
│       ├── sound_direction_finder.ino   Wi-Fi + LEDs + button version
│       └── secrets.example.h            copy to secrets.h (Wi-Fi credentials)
├── frontend/                     React + TypeScript + Vite dashboard
│   ├── src/
│   │   ├── components/           DashboardHeader, SemicircleRadar, MicrophoneLevels, DetectedDirection,
│   │   │                         LiveSoundIndicator, PeakMicrophone, HardwareStatus, SystemControl,
│   │   │                         ConnectionSettings, ModeSwitch, StatusBanner
│   │   ├── hooks/                useDashboard (central state + data sources), useNow, useAnimatedAngle
│   │   ├── services/             esp32Socket (WebSocket client), protocolParser, demoSimulator
│   │   ├── lib/                  dashboardState (reducer + view model), radarGeometry, micLevels,
│   │   │                         directionAlgorithm (TS port used by demo/tests), config, statusText
│   │   └── types/protocol.ts     typed JSON protocol
│   ├── scripts/
│   │   ├── mock-esp32.mjs        MOCK ESP32 SIMULATOR for testing without hardware
│   │   └── protocol-check.mjs    protocol test utility (works against mock or real ESP32)
│   ├── tests/                    unit tests (node:test)
│   └── .env.example
└── docs/PROTOCOL.md              WebSocket JSON protocol (every field documented)
```

## 1. Run the dashboard (no hardware needed)

Requires Node.js 22.6 or newer (tested with 22.15).

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. It starts in **DEMO MODE**: all values are simulated in the browser, a yellow
DEMO badge and banner are always visible, and nothing is sent to the ESP32.

## 2. Set up the ESP32

Full details are in [`firmware/README.md`](firmware/README.md).

1. **Libraries:** install *ESP32Servo*, *WebSockets* (Markus Sattler) and *ArduinoJson* v7 from the Library Manager.
2. **Wiring:** connect LED 1 → GPIO 25, LED 2 → GPIO 26 (each through a 220–330 Ω resistor to GND) and the push button
   between GPIO 27 and GND. Mics and servo are wired as before.
3. **Wi-Fi credentials:** copy `firmware/sound_direction_finder/secrets.example.h` to `secrets.h` in the same folder
   and enter your network name and password (2.4 GHz only). `secrets.h` is git-ignored.
4. **Upload** `firmware/sound_direction_finder/sound_direction_finder.ino` (board: *ESP32 Dev Module*).
5. **Find the IP:** in Serial Monitor (115200 baud) look for
   `Wi-Fi connected | IP: 192.168.x.y | Dashboard URL: ws://192.168.x.y:81`. You can also check your router's
   list of connected devices.

## 3. Connect the dashboard to the ESP32

1. **Use the same network:** connect the PC to the same Wi-Fi router as the ESP32. No internet connection is required.
2. **Check that it is reachable:** from the PC run `ping 192.168.x.y` and confirm you get replies.
3. **Set the URL** in one of two ways:
   * **In the UI:** switch to **Hardware**, enter `ws://192.168.x.y:81` under *ESP32 connection*, then **Apply**
     (remembered in this browser).
   * **From env:** copy `frontend/.env.example` to `frontend/.env.local`, set
     `VITE_ESP32_WS_URL=ws://192.168.x.y:81`, and restart `npm run dev`.

   The default `ws://192.168.1.120:81` is only an example. Use your ESP32's real address.
4. **Check that it works:**
   * The header shows **HARDWARE**, **ESP32 connected** and **System ON/OFF**. *Last telemetry update* in Hardware
     Status should keep saying "just now".
   * Clap near a microphone. The beam, Detected Direction, Mic Levels, LED 2 and the servo should all respond.
   * Press the physical button. Within about 0.2 s the dashboard shows **System OFF (by physical button)** and LED 1
     turns off.
   * Use the website switch. It shows *waiting for acknowledgement*, then *Confirmed by ESP32*.
   * From a terminal: `cd frontend && npm run protocol-check -- ws://192.168.x.y:81`

## Troubleshooting

| Symptom | Fix |
|---|---|
| "ESP32 disconnected · Connection error" | Wrong IP, ESP32 not on Wi-Fi, or PC on another network. Check Serial Monitor and `ping`. |
| `ping` works but the dashboard does not connect | Make sure the URL uses port **81** and starts with `ws://`. Turn off any VPN on the PC, since VPNs often block local-network traffic. |
| College or public Wi-Fi: nothing connects | Many campus networks block device-to-device traffic (client isolation). Use a personal router or a phone hotspot (set to 2.4 GHz) for both PC and ESP32. |
| Serial Monitor shows "Wi-Fi not connected; retrying..." | Wrong SSID or password in `secrets.h`, or a 5 GHz-only network. |
| `secrets.h not found` compile error | Copy `secrets.example.h` to `secrets.h`. |
| "Telemetry stale" | The ESP32 stopped sending (reset, out of range, weak RSSI). It recovers automatically; increase *Stale after* if the signal is weak. |
| Dashboard opened via `https://` | Browsers block `ws://` from HTTPS pages. Use the local `http://localhost:5173`. |
| Opening the dashboard from a phone | Run `npm run dev -- --host` and browse to `http://<PC-IP>:5173`. |

## Testing without hardware (mock simulator)

```bash
cd frontend
npm run mock-esp32            # MOCK ESP32 SIMULATOR on ws://localhost:8081
# Dashboard → Hardware → URL ws://localhost:8081 → Apply
```

The simulator speaks the real protocol, and the dashboard labels it **MOCK SIMULATOR**. Its values are never physical
hardware data. Type `b` + Enter to simulate a button press, or `s` + Enter to pause telemetry (tests *stale*).
Options: `--no-ack` (tests command timeout), `--reject` (tests a rejected command), `--port N`.

## Checks

```bash
cd frontend
npm run typecheck   # TypeScript (app + tests)
npm test            # 27 unit tests: radar geometry, algorithm, protocol parsing, state, commands
npm run build       # production build into frontend/dist
```

## Dashboard notes

* **Radar:** one transform, `x = cx + r·cos θ`, `y = cy − r·sin θ`, places 0° at the right, 90° at the top and
  180° at the left. The beam, source icon and readout all come from the ESP32's `estimatedAngle`. Mic icons are fixed
  at 0°, 60°, 120° and 180°.
* **No current sound:** the radar shows *Listening*. A dashed grey line marks the **last detected direction**, labelled
  as such.
* **Disabled, stale or disconnected:** the radar is dimmed with an explanation. Live panels show "—" and are never
  filled with old values.
* **Mic Levels:** the numbers are raw ESP32 values (average peak-to-peak ADC counts). The percentages and bars are
  computed in the browser as `(activity − noiseFloor) / (2 × (threshold − noiseFloor))`, clamped to 0–100 %. So
  50 % (the yellow tick) is the detection threshold.
* **Live Sound Indicator:** the loudest mic's relative level. "Sound Detected" comes only from the ESP32's
  `soundDetected` flag.
* **LED states** are the logical states the ESP32 commands, not electrical measurements.
* No external fonts or CDNs are used, so the dashboard works on an offline local network.
