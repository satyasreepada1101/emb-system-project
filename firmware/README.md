# Firmware — `sound_direction_finder`

`sound_direction_finder/sound_direction_finder.ino` is the Wi-Fi-enabled version of the original sketch
`../Mic_Test.ino.ino`. **The original file is untouched** and still works on its own as a backup.

## Libraries (Arduino IDE → Library Manager)

| Library | Author | Tested API |
|---|---|---|
| **ESP32Servo** | Kevin Harrington / John K. Bennett | same as original sketch |
| **WebSockets** | Markus Sattler (Links2004) | `WebSocketsServer`, v2.4+ |
| **ArduinoJson** | Benoit Blanchon | **v7.x** (uses `JsonDocument`) |

Board: **ESP32 Dev Module** (esp32 by Espressif, core 2.x or 3.x). `WiFi.h` ships with the core.

## Wiring

| Part | ESP32 pin | Notes |
|---|---|---|
| Mic 1 (0°) OUT | GPIO 32 | unchanged |
| Mic 2 (60°) OUT | GPIO 33 | unchanged |
| Mic 3 (120°) OUT | GPIO 34 | unchanged |
| Mic 4 (180°) OUT | GPIO 35 | unchanged |
| Servo signal | GPIO 18 | unchanged |
| **LED 1** (system enabled) | **GPIO 25** → 220–330 Ω → LED anode, cathode → GND | new |
| **LED 2** (sound detected) | **GPIO 26** → 220–330 Ω → LED anode, cathode → GND | new |
| **Push button** | **GPIO 27** ↔ button ↔ **GND** | new; internal pull-up, no resistor needed |

The microphones are on ADC1 (GPIO 32–35), which keeps working while Wi-Fi is active. ADC2 pins cannot be read while
Wi-Fi is on, so do not move the mics to ADC2 pins (0, 2, 4, 12–15, 25–27).

To use different LED/button pins, change `LED1_PIN`, `LED2_PIN`, `BUTTON_PIN`. Avoid strapping pins (0, 2, 5, 12, 15)
and input-only pins (34–39) for outputs.

## Wi-Fi credentials

1. In the sketch folder, copy `secrets.example.h` to `secrets.h`.
2. Edit `secrets.h`:
   ```c
   #define WIFI_SSID     "MyRouter"
   #define WIFI_PASSWORD "my-password"
   ```
3. `secrets.h` is in `.gitignore`, so it is never committed. The sketch stops with a clear `#error` if the file is
   missing.

The ESP32 only supports **2.4 GHz** networks.

## Upload and find the IP

1. Open `firmware/sound_direction_finder/sound_direction_finder.ino` in Arduino IDE.
2. Select board **ESP32 Dev Module** and the COM port, then upload.
3. Open Serial Monitor at **115200 baud**. You will see:
   ```
   Connecting to Wi-Fi "MyRouter" (non-blocking)...
   MICROPHONE NOISE CALIBRATION ...
   Wi-Fi connected | IP: 192.168.1.57 | Dashboard URL: ws://192.168.1.57:81
   WebSocket server listening on port 81
   ```
   The IP line is printed again every 30 s. You can also find the device (hostname like `esp32-xxxxxx`) in your
   router's DHCP client list. Reserving that IP in the router keeps it stable.

## Behaviour

| Item | Behaviour |
|---|---|
| Boot | Servo → 90°, LEDs off, Wi-Fi connects in the background, system becomes **enabled** (source `boot`) → LED 1 ON → 30 s calibration starts. |
| LED 1 | ON while the system is enabled (including during calibration), OFF while disabled. |
| LED 2 | ON while the latest 500 ms interval contained a qualifying sound; OFF during calibration and whenever disabled. |
| Button | Debounced (50 ms). Toggles enabled/disabled once per press; holding it does not repeat. Works without Wi-Fi. |
| Website | `setSystemEnabled` command calls the **same** `setSystemEnabled()` function as the button. |
| Disabled | Mic sampling and direction processing stop, the servo is not moved (it holds its last angle), both LEDs OFF, telemetry still sent, button still monitored, ESP32 stays powered. |
| Disabled during calibration | Calibration is aborted; it restarts from the beginning when re-enabled (a partial noise sample separated by a long gap would not be trustworthy). |
| Re-enabled after calibration | Listening resumes immediately using the existing thresholds; the detection-confirmation counter restarts. |
| No Wi-Fi | Detection, servo, LEDs and button all work normally; Wi-Fi is retried every 15 s. |

## What changed compared with `Mic_Test.ino.ino`

Unchanged: mic pins and angles, 12-bit ADC + 11 dB attenuation, `readSoundWindow()` (20 ms peak-to-peak),
calibration maths (150 windows, median, `MIN_THRESHOLD` 180, `MIN_NOISE_MARGIN` 100, `NOISE_MULTIPLIER` 1.35),
`estimateDirection()` (threshold, strongest mic, neighbour interpolation), `REQUIRED_DETECTIONS` 2, smoothing 0.35,
servo `180 − angle`, limits 10–170°, 5° minimum change, all Serial messages.

Restructured (behaviour preserved):

* **Calibration** was a blocking loop with `delay(180)` between windows. It is now a state (`PHASE_CALIBRATING`)
  that takes one 20 ms window every 200 ms, giving the same 150 windows over ≈30 s, while the button and WebSocket
  are serviced in between.
* **Listening** was a blocking 500 ms `while` loop inside `loop()`. It is now `PHASE_LISTENING`: each `loop()`
  call takes one 20 ms window and adds it to the totals; after 500 ms the original averaging and decision code runs
  unchanged (`finishListeningInterval()`).
* The final `delay(100)` after a confirmed detection became a non-blocking 100 ms `PHASE_SETTLE`.
* `estimateDirection()` gained an output parameter returning the strongest mic index for telemetry.
* A defensive `systemEnabled` check was added before `directionServo.write()`.

The longest blocking section is one 20 ms ADC window, so the button and network are serviced at least every ≈20 ms.
Servicing the network between windows takes a little time, so slightly fewer windows fit into each 500 ms interval
than before. The average per window is unaffected.

## Verifying on hardware

With the ESP32 on the network:

```bash
cd frontend
npm run protocol-check -- ws://<ESP32-IP>:81 --no-toggle   # read-only checks
npm run protocol-check -- ws://<ESP32-IP>:81               # also disables and re-enables the system
```

> This firmware has **not** been compiled or run on hardware in this environment (no Arduino toolchain was
> available). Compile it once in Arduino IDE and run the checks above before your demo.
