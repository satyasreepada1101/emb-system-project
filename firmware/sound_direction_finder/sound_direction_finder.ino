
#include <WiFi.h>
#include <ESP32Servo.h>
#include <WebSocketsServer.h>   // "WebSockets" library by Markus Sattler
#include <ArduinoJson.h>        // ArduinoJson v7 by Benoit Blanchon

// Wi-Fi credentials live in secrets.h (NOT committed).
// Copy secrets.example.h to secrets.h and edit it.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "secrets.h not found: copy secrets.example.h to secrets.h and set WIFI_SSID / WIFI_PASSWORD"
#endif

// =====================================================
// 4-MIC SOUND DIRECTION DETECTION + Wi-Fi DASHBOARD
// ESP32-WROOM-32 + 4 MAX9814 + SG90 SERVO
// + 2 LEDs + push button + WebSocket telemetry
// Amplitude-based localization (NOT TDOA)
//
// Based on Mic_Test.ino.ino. The detection algorithm,
// calibration maths, thresholds, smoothing and servo
// reversal are unchanged. Only the scheduling has been
// made non-blocking so the button and WebSocket server
// stay responsive (see firmware/README.md).
// =====================================================

#define FIRMWARE_VERSION "sound-direction-finder 1.0.0"

// ---------------- PIN CONFIGURATION ----------------
const int micPins[4] = {32, 33, 34, 35};   // ADC1 pins: usable while Wi-Fi is on
const int SERVO_PIN = 18;

const int LED1_PIN = 25;     // LED 1: system enabled
const int LED2_PIN = 26;     // LED 2: qualifying sound detected
const int BUTTON_PIN = 27;   // Momentary button to GND (internal pull-up)

// Physical direction assigned to each microphone
// Confirm this mapping against your actual arrangement.
const float micAngles[4] = {0.0, 60.0, 120.0, 180.0};

// ---------------- CALIBRATION ----------------
const unsigned long CALIBRATION_MS = 30000;
const unsigned long WINDOW_MS = 20;

const int MIN_THRESHOLD = 180;
const int MIN_NOISE_MARGIN = 100;
const float NOISE_MULTIPLIER = 1.35;

const int CALIBRATION_WINDOWS = 150;
const unsigned long CALIBRATION_SPACING_MS =
  CALIBRATION_MS / CALIBRATION_WINDOWS;   // 200 ms, as in the original

// ---------------- LISTENING ----------------
const unsigned long LISTEN_MS = 500;
const unsigned long POST_MOVE_PAUSE_MS = 100;   // original delay(100)

// ---------------- STABILITY ----------------
const float SMOOTHING_FACTOR = 0.35;
const float MIN_ANGLE_CHANGE = 5.0;
const int REQUIRED_DETECTIONS = 2;

// ---------------- SERVO LIMITS ----------------
const int SERVO_MIN_ANGLE = 10;
const int SERVO_MAX_ANGLE = 170;

// ---------------- BUTTON ----------------
const unsigned long DEBOUNCE_MS = 50;

// ---------------- NETWORK ----------------
const uint16_t WEBSOCKET_PORT = 81;
const unsigned long TELEMETRY_INTERVAL_MS = 200;
const unsigned long WIFI_RETRY_MS = 15000;
const unsigned long NETWORK_INFO_INTERVAL_MS = 30000;
const size_t MAX_COMMAND_LENGTH = 512;
const size_t MAX_COMMAND_ID_LENGTH = 64;

// ---------------- SERVO STATE ----------------
Servo directionServo;

int currentServoAngle = 90;
float smoothedEstimatedAngle = 90.0;

bool hasPreviousEstimate = false;
int consecutiveDetections = 0;

// ---------------- MIC CALIBRATION ----------------
int noiseFloor[4] = {0, 0, 0, 0};
int soundThreshold[4] = {0, 0, 0, 0};

// ---------------- SYSTEM STATE ----------------
enum DetectorPhase {
  PHASE_IDLE,          // system disabled: no mic processing
  PHASE_CALIBRATING,   // collecting noise calibration windows
  PHASE_LISTENING,     // accumulating a 500 ms listening interval
  PHASE_SETTLE         // short pause after a confirmed detection
};

enum ChangeSource { SOURCE_BOOT, SOURCE_BUTTON, SOURCE_WEB };

DetectorPhase phase = PHASE_IDLE;
bool systemEnabled = false;
ChangeSource enableSource = SOURCE_BOOT;
bool calibrated = false;

// Calibration progress
int calibrationSamples[4][CALIBRATION_WINDOWS];
int calibrationCount = 0;
unsigned long lastCalibrationWindowAt = 0;

// Listening interval accumulation
unsigned long listenTotals[4] = {0, 0, 0, 0};
unsigned long listenWindows = 0;
unsigned long listenStart = 0;
unsigned long settleStart = 0;

// Latest completed listening interval (reported via telemetry)
bool hasMicActivity = false;
int latestMicActivity[4] = {0, 0, 0, 0};
bool soundDetected = false;
bool hasCurrentEstimate = false;
float latestEstimatedAngle = 0.0;
int latestStrongestMic = -1;          // 0-based, -1 = none
unsigned long measurementCount = 0;

// Commanded logical LED states
bool led1On = false;
bool led2On = false;

// Button debounce
int buttonStableState = HIGH;
int buttonLastReading = HIGH;
unsigned long buttonLastChangeAt = 0;

// Network
WebSocketsServer webSocket(WEBSOCKET_PORT);
bool webSocketStarted = false;
bool wifiWasConnected = false;
unsigned long lastWifiAttemptAt = 0;
unsigned long lastNetworkInfoAt = 0;
unsigned long lastTelemetryAt = 0;
bool telemetryDue = false;
uint32_t telemetrySequence = 0;

// Forward declarations (functions used before their definition)
void startListeningInterval();
bool setSystemEnabled(bool enabled, ChangeSource source);

const char *sourceName(ChangeSource source) {
  switch (source) {
    case SOURCE_BUTTON: return "button";
    case SOURCE_WEB:    return "web";
    default:            return "boot";
  }
}

// ---------------- LEDS ----------------
void updateLeds() {
  led1On = systemEnabled;
  led2On = systemEnabled && phase != PHASE_CALIBRATING && soundDetected;

  digitalWrite(LED1_PIN, led1On ? HIGH : LOW);
  digitalWrite(LED2_PIN, led2On ? HIGH : LOW);
}

// ---------------- SOUND ACTIVITY ----------------
// Measures peak-to-peak ADC variation in each window.
void readSoundWindow(int activity[4]) {
  int minVal[4] = {4095, 4095, 4095, 4095};
  int maxVal[4] = {0, 0, 0, 0};

  unsigned long start = millis();

  while (millis() - start < WINDOW_MS) {
    for (int i = 0; i < 4; i++) {
      int value = analogRead(micPins[i]);

      if (value < minVal[i]) minVal[i] = value;
      if (value > maxVal[i]) maxVal[i] = value;
    }
  }

  for (int i = 0; i < 4; i++) {
    activity[i] = maxVal[i] - minVal[i];
  }
}

// ---------------- AUTOMATIC CALIBRATION ----------------
// Uses median activity values to reduce the influence
// of occasional loud sounds during calibration.
// Non-blocking: one 20 ms window every 200 ms, so the
// button and WebSocket are serviced in between.
void startCalibration() {
  calibrationCount = 0;
  lastCalibrationWindowAt = 0;
  calibrated = false;
  phase = PHASE_CALIBRATING;

  Serial.println();
  Serial.println("====================================");
  Serial.println("MICROPHONE NOISE CALIBRATION");
  Serial.println("Duration: approximately 30 seconds");
  Serial.println("Keep normal room background noise.");
  Serial.println("Avoid clapping or deliberate test sounds.");
  Serial.println("====================================");
}

void finishCalibration() {
  // Sort each microphone's calibration values.
  for (int mic = 0; mic < 4; mic++) {
    for (int i = 0; i < CALIBRATION_WINDOWS - 1; i++) {
      for (int j = i + 1; j < CALIBRATION_WINDOWS; j++) {
        if (calibrationSamples[mic][j] < calibrationSamples[mic][i]) {
          int temp = calibrationSamples[mic][i];
          calibrationSamples[mic][i] = calibrationSamples[mic][j];
          calibrationSamples[mic][j] = temp;
        }
      }
    }

    noiseFloor[mic] = calibrationSamples[mic][CALIBRATION_WINDOWS / 2];

    int margin = max(
      MIN_NOISE_MARGIN,
      (int)(noiseFloor[mic] * (NOISE_MULTIPLIER - 1.0))
    );

    soundThreshold[mic] = max(
      MIN_THRESHOLD,
      noiseFloor[mic] + margin
    );

    Serial.printf(
      "Mic %d | Noise floor: %d | Threshold: %d\n",
      mic + 1,
      noiseFloor[mic],
      soundThreshold[mic]
    );
  }

  calibrated = true;

  Serial.println("Calibration complete.");
  Serial.println("Amplitude-based direction detection active.");
}

void serviceCalibration() {
  if (calibrationCount > 0 &&
      millis() - lastCalibrationWindowAt < CALIBRATION_SPACING_MS) {
    return;
  }

  lastCalibrationWindowAt = millis();

  int activity[4];
  readSoundWindow(activity);

  for (int mic = 0; mic < 4; mic++) {
    calibrationSamples[mic][calibrationCount] = activity[mic];
  }

  calibrationCount++;

  if (calibrationCount % 25 == 0) {
    Serial.printf(
      "Calibration progress: %d%%\n",
      (calibrationCount * 100) / CALIBRATION_WINDOWS
    );
  }

  if (calibrationCount >= CALIBRATION_WINDOWS) {
    finishCalibration();
    startListeningInterval();
    updateLeds();
    telemetryDue = true;
  }
}

// ---------------- DIRECTION ESTIMATION ----------------
// Unchanged from the original, except that the strongest
// microphone index is also returned for telemetry.
bool estimateDirection(const int activity[4], float &angle, int &strongestOut) {
  float strength[4] = {0, 0, 0, 0};

  int strongest = -1;
  float strongestStrength = 0;

  strongestOut = -1;

  // Remove each microphone's calibrated background level.
  for (int i = 0; i < 4; i++) {
    if (activity[i] > soundThreshold[i]) {
      strength[i] = activity[i] - noiseFloor[i];

      if (strength[i] > strongestStrength) {
        strongestStrength = strength[i];
        strongest = i;
      }
    }
  }

  if (strongest < 0) {
    return false;
  }

  angle = micAngles[strongest];

  // Choose the stronger qualifying adjacent microphone.
  int neighbour = -1;

  if (strongest > 0 && strength[strongest - 1] > 0) {
    neighbour = strongest - 1;
  }

  if (strongest < 3 && strength[strongest + 1] > 0) {
    if (neighbour < 0 ||
        strength[strongest + 1] > strength[neighbour]) {
      neighbour = strongest + 1;
    }
  }

  // Interpolate toward the selected neighbour.
  if (neighbour >= 0) {
    float a = strength[strongest];
    float b = strength[neighbour];

    if (a + b > 0) {
      float fraction = b / (a + b);

      angle += fraction *
        (micAngles[neighbour] - micAngles[strongest]);
    }
  }

  angle = constrain(angle, 0.0, 180.0);

  Serial.printf("Strongest microphone: Mic %d\n", strongest + 1);

  strongestOut = strongest;
  return true;
}

// ---------------- LISTENING (non-blocking) ----------------
void startListeningInterval() {
  for (int i = 0; i < 4; i++) {
    listenTotals[i] = 0;
  }

  listenWindows = 0;
  listenStart = millis();
  phase = PHASE_LISTENING;
}

// Same logic as the original loop() body, run once per
// completed 500 ms listening interval.
void finishListeningInterval() {
  int average[4] = {0, 0, 0, 0};

  for (int i = 0; i < 4; i++) {
    if (listenWindows > 0) {
      average[i] = listenTotals[i] / listenWindows;
    }
    latestMicActivity[i] = average[i];
  }

  hasMicActivity = true;
  measurementCount++;

  Serial.printf(
    "\nM1:%d (T:%d) | M2:%d (T:%d) | "
    "M3:%d (T:%d) | M4:%d (T:%d)\n",
    average[0], soundThreshold[0],
    average[1], soundThreshold[1],
    average[2], soundThreshold[2],
    average[3], soundThreshold[3]
  );

  float estimatedAngle = 90.0;
  int strongest = -1;

  if (!estimateDirection(average, estimatedAngle, strongest)) {
    consecutiveDetections = 0;

    soundDetected = false;
    hasCurrentEstimate = false;
    latestStrongestMic = -1;
    updateLeds();

    Serial.println("No qualifying sound detected.");
    Serial.printf("Servo HOLDING at %d degrees\n",
                  currentServoAngle);
    startListeningInterval();
    return;
  }

  soundDetected = true;
  hasCurrentEstimate = true;
  latestEstimatedAngle = estimatedAngle;
  latestStrongestMic = strongest;
  updateLeds();

  consecutiveDetections++;

  Serial.printf(
    "Estimated direction: %.1f degrees\n",
    estimatedAngle
  );

  // Require consecutive qualifying windows before moving.
  if (consecutiveDetections < REQUIRED_DETECTIONS) {
    Serial.println("Confirming sound direction...");
    startListeningInterval();
    return;
  }

  // Reset count so the next movement also requires confirmation.
  consecutiveDetections = 0;

  // Smooth the direction estimate.
  if (!hasPreviousEstimate) {
    smoothedEstimatedAngle = estimatedAngle;
    hasPreviousEstimate = true;
  } else {
    smoothedEstimatedAngle =
      SMOOTHING_FACTOR * estimatedAngle +
      (1.0 - SMOOTHING_FACTOR) * smoothedEstimatedAngle;
  }

  Serial.printf(
    "Smoothed direction: %.1f degrees\n",
    smoothedEstimatedAngle
  );

  // Reverse the servo direction for your mounting arrangement.
  int targetAngle =
    180 - (int)(smoothedEstimatedAngle + 0.5);

  targetAngle = constrain(
    targetAngle,
    SERVO_MIN_ANGLE,
    SERVO_MAX_ANGLE
  );

  Serial.printf("Servo target: %d degrees\n", targetAngle);

  // Never move the servo while disabled (defensive: this
  // function is only reached while enabled).
  if (systemEnabled &&
      abs(targetAngle - currentServoAngle) >= MIN_ANGLE_CHANGE) {
    directionServo.write(targetAngle);
    currentServoAngle = targetAngle;
    Serial.println("Servo moved.");
  } else {
    Serial.println("Small change; servo held.");
  }

  // Replaces the original delay(100) without blocking.
  settleStart = millis();
  phase = PHASE_SETTLE;
}

void serviceListening() {
  if (millis() - listenStart < LISTEN_MS) {
    int activity[4];

    readSoundWindow(activity);

    for (int i = 0; i < 4; i++) {
      listenTotals[i] += activity[i];
    }

    listenWindows++;
    return;
  }

  finishListeningInterval();
}

// ---------------- ENABLE / DISABLE ----------------
// Single code path used by both the physical button and
// the website command. Returns true if the state changed.
void clearLiveMeasurements() {
  hasMicActivity = false;
  soundDetected = false;
  hasCurrentEstimate = false;
  latestStrongestMic = -1;
}

bool setSystemEnabled(bool enabled, ChangeSource source) {
  if (enabled == systemEnabled) {
    return false;
  }

  systemEnabled = enabled;
  enableSource = source;

  if (enabled) {
    Serial.printf("\n*** SYSTEM ENABLED (%s) ***\n", sourceName(source));

    clearLiveMeasurements();
    consecutiveDetections = 0;

    if (calibrated) {
      startListeningInterval();
    } else {
      startCalibration();
    }
  } else {
    Serial.printf("\n*** SYSTEM DISABLED (%s) ***\n", sourceName(source));

    if (phase == PHASE_CALIBRATING) {
      Serial.println("Calibration aborted; it will restart when re-enabled.");
    }

    // Stop detection and servo updates. The servo keeps
    // holding its last position.
    phase = PHASE_IDLE;
    clearLiveMeasurements();
    consecutiveDetections = 0;
  }

  updateLeds();
  telemetryDue = true;
  return true;
}

// ---------------- PUSH BUTTON ----------------
// Debounced; toggles once per press. Holding the button
// does not cause repeated toggles.
void serviceButton() {
  int reading = digitalRead(BUTTON_PIN);
  unsigned long now = millis();

  if (reading != buttonLastReading) {
    buttonLastReading = reading;
    buttonLastChangeAt = now;
  }

  if (now - buttonLastChangeAt >= DEBOUNCE_MS &&
      reading != buttonStableState) {
    buttonStableState = reading;

    if (buttonStableState == LOW) {
      setSystemEnabled(!systemEnabled, SOURCE_BUTTON);
    }
  }
}

// ---------------- TELEMETRY ----------------
void addIntArray(JsonDocument &doc, const char *key, const int values[4]) {
  JsonArray array = doc[key].to<JsonArray>();

  for (int i = 0; i < 4; i++) {
    array.add(values[i]);
  }
}

void buildTelemetry(String &out) {
  JsonDocument doc;

  doc["type"] = "telemetry";
  doc["sequence"] = ++telemetrySequence;
  doc["uptimeMs"] = (uint32_t)millis();
  doc["systemEnabled"] = systemEnabled;
  doc["enableSource"] = sourceName(enableSource);
  doc["calibrating"] = phase == PHASE_CALIBRATING;
  doc["calibrated"] = calibrated;
  doc["calibrationProgress"] =
    calibrated ? 100 :
    (phase == PHASE_CALIBRATING ? (calibrationCount * 100) / CALIBRATION_WINDOWS : 0);
  doc["soundDetected"] = systemEnabled && soundDetected;
  doc["measurementCount"] = (uint32_t)measurementCount;

  if (systemEnabled && hasMicActivity) {
    addIntArray(doc, "micActivity", latestMicActivity);
  } else {
    doc["micActivity"] = nullptr;
  }

  if (calibrated) {
    addIntArray(doc, "micThresholds", soundThreshold);
    addIntArray(doc, "micNoiseFloors", noiseFloor);
  } else {
    doc["micThresholds"] = nullptr;
    doc["micNoiseFloors"] = nullptr;
  }

  if (systemEnabled && hasCurrentEstimate) {
    doc["estimatedAngle"] = serialized(String(latestEstimatedAngle, 1));
    doc["strongestMic"] = latestStrongestMic + 1;   // 1..4
  } else {
    doc["estimatedAngle"] = nullptr;
    doc["strongestMic"] = nullptr;
  }

  if (hasPreviousEstimate) {
    doc["smoothedAngle"] = serialized(String(smoothedEstimatedAngle, 1));
  } else {
    doc["smoothedAngle"] = nullptr;
  }

  doc["servoTarget"] = currentServoAngle;
  doc["led1On"] = led1On;
  doc["led2On"] = led2On;
  doc["rssi"] = WiFi.RSSI();

  serializeJson(doc, out);
}

void serviceTelemetry() {
  if (!webSocketStarted || webSocket.connectedClients() == 0) {
    telemetryDue = false;
    return;
  }

  unsigned long now = millis();

  if (!telemetryDue && now - lastTelemetryAt < TELEMETRY_INTERVAL_MS) {
    return;
  }

  lastTelemetryAt = now;
  telemetryDue = false;

  String out;
  buildTelemetry(out);
  webSocket.broadcastTXT(out);
}

// ---------------- WEBSOCKET COMMANDS ----------------
void sendError(uint8_t client, const char *message) {
  JsonDocument doc;
  doc["type"] = "error";
  doc["message"] = message;

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(client, out);
}

void sendAck(uint8_t client, const char *commandId, bool accepted, const char *message) {
  JsonDocument doc;
  doc["type"] = "commandAck";
  doc["commandId"] = commandId;
  doc["accepted"] = accepted;
  doc["systemEnabled"] = systemEnabled;
  doc["message"] = message;

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(client, out);
}

void sendHello(uint8_t client) {
  JsonDocument doc;
  doc["type"] = "hello";
  doc["device"] = "esp32";
  doc["firmware"] = FIRMWARE_VERSION;
  doc["telemetryIntervalMs"] = TELEMETRY_INTERVAL_MS;
  doc["servoMin"] = SERVO_MIN_ANGLE;
  doc["servoMax"] = SERVO_MAX_ANGLE;

  JsonArray angles = doc["micAngles"].to<JsonArray>();
  for (int i = 0; i < 4; i++) {
    angles.add((int)micAngles[i]);
  }

  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(client, out);
}

void handleCommand(uint8_t client, uint8_t *payload, size_t length) {
  if (length == 0 || length > MAX_COMMAND_LENGTH) {
    sendError(client, "Empty or oversized message");
    return;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);

  if (err || !doc.is<JsonObject>()) {
    sendError(client, "Malformed JSON: expected an object");
    return;
  }

  const char *commandId = doc["commandId"].as<const char *>();

  if (commandId == nullptr ||
      strlen(commandId) == 0 ||
      strlen(commandId) > MAX_COMMAND_ID_LENGTH) {
    sendError(client, "Missing or invalid commandId");
    return;
  }

  const char *type = doc["type"].as<const char *>();

  if (type == nullptr || strcmp(type, "setSystemEnabled") != 0) {
    sendAck(client, commandId, false, "Unsupported command type");
    return;
  }

  if (!doc["enabled"].is<bool>()) {
    sendAck(client, commandId, false, "Field 'enabled' must be true or false");
    return;
  }

  bool requested = doc["enabled"].as<bool>();
  bool changed = setSystemEnabled(requested, SOURCE_WEB);

  const char *message;
  if (requested) {
    message = changed ? "System enabled" : "System already enabled";
  } else {
    message = changed ? "System disabled" : "System already disabled";
  }

  sendAck(client, commandId, true, message);
  telemetryDue = true;
}

void onWebSocketEvent(uint8_t client, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("WebSocket client %u connected\n", client);
      sendHello(client);
      telemetryDue = true;
      break;

    case WStype_DISCONNECTED:
      Serial.printf("WebSocket client %u disconnected\n", client);
      break;

    case WStype_TEXT:
      handleCommand(client, payload, length);
      break;

    default:
      break;
  }
}

// ---------------- WI-FI ----------------
void printNetworkInfo() {
  Serial.printf(
    "Wi-Fi connected | IP: %s | Dashboard URL: ws://%s:%u\n",
    WiFi.localIP().toString().c_str(),
    WiFi.localIP().toString().c_str(),
    WEBSOCKET_PORT
  );
}

void setupWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);          // lower WebSocket latency
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptAt = millis();

  Serial.printf("Connecting to Wi-Fi \"%s\" (non-blocking)...\n", WIFI_SSID);
}

// Detection and the button work without Wi-Fi; the network
// is serviced opportunistically.
void serviceWiFi() {
  bool connected = WiFi.status() == WL_CONNECTED;
  unsigned long now = millis();

  if (connected && !wifiWasConnected) {
    printNetworkInfo();
    lastNetworkInfoAt = now;

    if (!webSocketStarted) {
      webSocket.begin();
      webSocket.onEvent(onWebSocketEvent);
      webSocketStarted = true;
      Serial.printf("WebSocket server listening on port %u\n", WEBSOCKET_PORT);
    }
  }

  if (!connected && wifiWasConnected) {
    Serial.println("Wi-Fi connection lost; reconnecting...");
    lastWifiAttemptAt = now;
  }

  if (!connected && now - lastWifiAttemptAt >= WIFI_RETRY_MS) {
    Serial.println("Wi-Fi not connected; retrying...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiAttemptAt = now;
  }

  if (connected && now - lastNetworkInfoAt >= NETWORK_INFO_INTERVAL_MS) {
    printNetworkInfo();
    lastNetworkInfoAt = now;
  }

  wifiWasConnected = connected;
}

// Called between every 20 ms measurement window.
void serviceIO() {
  serviceButton();
  serviceWiFi();

  if (webSocketStarted) {
    webSocket.loop();
  }

  serviceTelemetry();
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);

  // ESP32 ADC configuration for analog microphone signals.
  for (int i = 0; i < 4; i++) {
    pinMode(micPins[i], INPUT);
    analogSetPinAttenuation(micPins[i], ADC_11db);
  }

  pinMode(LED1_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  updateLeds();   // both OFF until the system is enabled

  buttonLastReading = digitalRead(BUTTON_PIN);
  buttonStableState = buttonLastReading;

  directionServo.setPeriodHertz(50);
  directionServo.attach(SERVO_PIN, 500, 2400);

  currentServoAngle = 90;
  directionServo.write(currentServoAngle);

  delay(1000);

  Serial.println();
  Serial.println("4-MIC SOUND DIRECTION PROJECT");
  Serial.println("ESP32 + MAX9814 + SG90");
  Serial.println("Servo initialized at 90 degrees.");

  setupWiFi();

  // The system starts enabled, which begins calibration.
  setSystemEnabled(true, SOURCE_BOOT);
}

// ---------------- MAIN LOOP ----------------
void loop() {
  serviceIO();

  switch (phase) {
    case PHASE_CALIBRATING:
      serviceCalibration();
      break;

    case PHASE_LISTENING:
      serviceListening();
      break;

    case PHASE_SETTLE:
      if (millis() - settleStart >= POST_MOVE_PAUSE_MS) {
        startListeningInterval();
      }
      break;

    case PHASE_IDLE:
    default:
      delay(1);   // disabled: just keep servicing button and network
      break;
  }
}
