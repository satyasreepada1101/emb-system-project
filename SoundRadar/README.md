# Sound Radar

This folder contains a browser dashboard and a matching ESP32 sketch. The dashboard renders the estimated sound direction on a 0°–180° front-hemisphere radar and shows all four microphone activity levels, their calibrated thresholds, and the servo position.

## Run the dashboard

1. Upload `code\code.ino` to the ESP32. It uses the ESP32Servo library and the pin assignments shown below.
2. Close Arduino Serial Monitor (only one program can use the ESP32 serial port at a time).
3. Install Python 3 if it is not already available.
4. Open a terminal in this folder and run:

   ```powershell
   python server.py
   ```

5. Open [http://localhost:8000](http://localhost:8000) in a recent version of Chrome or Microsoft Edge.
6. Select **Connect device**, choose the ESP32 serial port, and allow access.

The web page reads the ESP32's USB serial stream directly using the browser's Web Serial API. No Python packages, cloud connection, or separate serial-to-web bridge are needed. The sketch emits JSON telemetry at 115200 baud.

## Calibration and direction

The sketch calibrates the microphone noise floor for about 30 seconds after reset. Connect the browser at any time; the page will display the latest calibration progress it receives and then show live readings. Keep normal background noise during calibration and avoid loud test sounds.

The radar uses the sketch's microphone direction mapping: Mic 1 at 0° (left), Mic 2 at 60°, Mic 3 at 120°, and Mic 4 at 180° (right). 90° is straight ahead. Change `micAngles` in `code.ino` if the physical microphone order differs. The servo angle is shown separately because the sketch reverses the estimated direction for its mounting.

## Hardware button

The push button is connected between GPIO 27 and GND (`INPUT_PULLUP`). Its only action is recalibrating the microphone noise floor when held for 2 seconds; a shorter press does nothing. While connected, the webpage shows the live button press and hold-to-recalibrate progress; button input is handled by the ESP32.

The browser serial chooser is provided by Chrome/Edge and requires the page to be served from localhost. Do not open `index.html` directly from the file system.
