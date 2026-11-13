
#include <ESP32Servo.h>

// =====================================================
// 4-MIC SOUND DIRECTION DETECTION
// ESP32-WROOM-32 + 4 MAX9814 + SG90 SERVO
//
// BUTTON:
// SHORT PRESS = PAUSE / RESUME
// LONG PRESS  = RECALIBRATE
//
// LED 1 (GREEN)  = SYSTEM RUNNING
// LED 2 (YELLOW) = DIRECTION DETECTED / PAUSED
//
// AUTOMATIC STARTUP CALIBRATION
// AMPLITUDE-BASED LOCALIZATION (NOT TDOA)
// =====================================================


// ---------------- PIN CONFIGURATION ----------------

const int micPins[4] = {32, 33, 34, 35};

const int SERVO_PIN = 18;
const int BUTTON_PIN = 27;

const int LED_SYSTEM = 25;
const int LED_DIRECTION = 26;

const float micAngles[4] = {
  0.0, 60.0, 120.0, 180.0
};


// ---------------- CALIBRATION ----------------

const unsigned long CALIBRATION_MS = 30000;
const unsigned long WINDOW_MS = 20;

const int MIN_THRESHOLD = 180;
const int MIN_NOISE_MARGIN = 100;
const float NOISE_MULTIPLIER = 1.35;


// ---------------- LISTENING ----------------

const unsigned long LISTEN_MS = 500;


// ---------------- STABILITY ----------------

const float SMOOTHING_FACTOR = 0.35;
const float MIN_ANGLE_CHANGE = 5.0;
const int REQUIRED_DETECTIONS = 2;


// ---------------- SERVO LIMITS ----------------

const int SERVO_MIN_ANGLE = 10;
const int SERVO_MAX_ANGLE = 170;


// ---------------- BUTTON SETTINGS ----------------

const unsigned long DEBOUNCE_MS = 50;
const unsigned long LONG_PRESS_MS = 2000;

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;

unsigned long lastDebounceTime = 0;
unsigned long buttonPressStart = 0;
unsigned long lastButtonUpdateTime = 0;

bool longPressHandled = false;


// ---------------- BUTTON EVENTS ----------------

enum ButtonEvent {
  NO_EVENT,
  LONG_PRESS
};


// ---------------- SYSTEM STATE ----------------

bool systemStarted = false;

Servo directionServo;

int currentServoAngle = 90;

float smoothedEstimatedAngle = 90.0;

bool hasPreviousEstimate = false;

int consecutiveDetections = 0;


// ---------------- MIC CALIBRATION ----------------

int noiseFloor[4] = {0, 0, 0, 0};
int soundThreshold[4] = {0, 0, 0, 0};

int lastStrongestMic = 0;


// =====================================================
// LED CONTROL
// =====================================================

void updateLEDs() {

  if (!systemStarted) {

    // Calibration / startup
    digitalWrite(LED_SYSTEM, HIGH);
    digitalWrite(LED_DIRECTION, LOW);

    return;

  }

  // System is active and listening
  digitalWrite(LED_SYSTEM, HIGH);

  // Yellow LED reflects the last detection state.
  // Its state is updated during sound processing.
}


// =====================================================
// SERIAL JSON OUTPUT
// =====================================================

void emitCalibration(int progress) {

  Serial.printf(
    "{\"event\":\"calibration\",\"progress\":%d}\n",
    progress
  );

}


void emitTelemetry(
  const char *event,
  const int activity[4],
  bool hasAngle,
  float angle
) {

  Serial.printf(
    "{\"event\":\"%s\",\"detected\":%s,\"strongestMic\":%d,"
    "\"angle\":",
    event,
    hasAngle ? "true" : "false",
    lastStrongestMic
  );

  if (hasAngle) {
    Serial.printf("%.1f", angle);
  } else {
    Serial.print("null");
  }

  Serial.printf(
    ",\"smoothedAngle\":%.1f,\"servoAngle\":%d,"
    "\"mics\":[%d,%d,%d,%d],"
    "\"thresholds\":[%d,%d,%d,%d]}\n",

    smoothedEstimatedAngle,
    currentServoAngle,

    activity[0],
    activity[1],
    activity[2],
    activity[3],

    soundThreshold[0],
    soundThreshold[1],
    soundThreshold[2],
    soundThreshold[3]
  );

}


// =====================================================
// BUTTON STATE RESET
// =====================================================

void resetButtonState() {

  lastButtonReading = digitalRead(BUTTON_PIN);
  stableButtonState = lastButtonReading;

  lastDebounceTime = millis();
  buttonPressStart = millis();
  lastButtonUpdateTime = buttonPressStart;

  // Ignore a button already held during calibration.
  longPressHandled = (stableButtonState == LOW);

}


// =====================================================
// BUTTON WITH DEBOUNCING
// LONG PRESS = RECALIBRATE
// =====================================================

ButtonEvent checkButton() {

  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {

    lastDebounceTime = millis();

    lastButtonReading = reading;

  }

  if (millis() - lastDebounceTime >= DEBOUNCE_MS) {

    if (reading != stableButtonState) {

      stableButtonState = reading;

      // BUTTON PRESSED

      if (stableButtonState == LOW) {

        buttonPressStart = millis();
        lastButtonUpdateTime = buttonPressStart;

        longPressHandled = false;

        Serial.println(
          "{\"event\":\"button_pressed\",\"durationMs\":0,\"holdProgress\":0}"
        );

      }

      // BUTTON RELEASED

      else {

        unsigned long pressDuration = millis() - buttonPressStart;

        int holdProgress = min(
          100UL,
          (pressDuration * 100UL) / LONG_PRESS_MS
        );

        Serial.printf(
          "{\"event\":\"button_released\",\"durationMs\":%lu,\"holdProgress\":%d}\n",
          pressDuration,
          holdProgress
        );

      }

    }

  }

  // BUTTON HOLD TELEMETRY

  if (
    stableButtonState == LOW &&
    !longPressHandled &&
    millis() - lastButtonUpdateTime >= 100
  ) {

    lastButtonUpdateTime = millis();

    unsigned long pressDuration =
      lastButtonUpdateTime - buttonPressStart;

    int holdProgress = min(
      100UL,
      (pressDuration * 100UL) / LONG_PRESS_MS
    );

    Serial.printf(
      "{\"event\":\"button_hold\",\"durationMs\":%lu,\"holdProgress\":%d}\n",
      pressDuration,
      holdProgress
    );

  }

  // LONG PRESS DETECTION

  if (
    stableButtonState == LOW &&
    !longPressHandled &&
    millis() - buttonPressStart >= LONG_PRESS_MS
  ) {

    longPressHandled = true;

    return LONG_PRESS;

  }

  return NO_EVENT;

}


// =====================================================
// READ SOUND ACTIVITY
// PEAK-TO-PEAK ADC VARIATION
// =====================================================

void readSoundWindow(int activity[4]) {

  int minVal[4] = {4095, 4095, 4095, 4095};

  int maxVal[4] = {0, 0, 0, 0};

  unsigned long start = millis();

  while (millis() - start < WINDOW_MS) {

    for (int i = 0; i < 4; i++) {

      int value = analogRead(micPins[i]);

      if (value < minVal[i])
        minVal[i] = value;

      if (value > maxVal[i])
        maxVal[i] = value;

    }

  }

  for (int i = 0; i < 4; i++) {

    activity[i] = maxVal[i] - minVal[i];

  }

}


// =====================================================
// AUTOMATIC NOISE CALIBRATION
// =====================================================

void calibrateNoise() {

  const int NUM_WINDOWS = 150;

  int samples[4][NUM_WINDOWS];

  emitCalibration(0);

  Serial.println(
    "{\"event\":\"calibration_started\"}"
  );

  for (int n = 0; n < NUM_WINDOWS; n++) {

    int activity[4];

    readSoundWindow(activity);

    for (int mic = 0; mic < 4; mic++) {

      samples[mic][n] = activity[mic];

    }

    if ((n + 1) % 5 == 0) {

      emitCalibration(
        ((n + 1) * 100) / NUM_WINDOWS
      );

    }

    delay(
      max(
        0L,
        (long)(CALIBRATION_MS / NUM_WINDOWS)
        - (long)WINDOW_MS
      )
    );

  }


  // SORT VALUES AND CALCULATE MEDIAN

  for (int mic = 0; mic < 4; mic++) {

    for (int i = 0; i < NUM_WINDOWS - 1; i++) {

      for (int j = i + 1; j < NUM_WINDOWS; j++) {

        if (samples[mic][j] < samples[mic][i]) {

          int temp = samples[mic][i];

          samples[mic][i] = samples[mic][j];

          samples[mic][j] = temp;

        }

      }

    }

    noiseFloor[mic] =
      samples[mic][NUM_WINDOWS / 2];

    int margin = max(
      MIN_NOISE_MARGIN,
      (int)(
        noiseFloor[mic] *
        (NOISE_MULTIPLIER - 1.0)
      )
    );

    soundThreshold[mic] = max(
      MIN_THRESHOLD,
      noiseFloor[mic] + margin
    );

  }

  emitCalibration(100);

  Serial.println(
    "{\"event\":\"calibration_complete\"}"
  );

}


// =====================================================
// ESTIMATE SOUND DIRECTION
// =====================================================

bool estimateDirection(
  const int activity[4],
  float &angle
) {

  float strength[4] = {0, 0, 0, 0};

  int strongest = -1;

  float strongestStrength = 0;

  for (int i = 0; i < 4; i++) {

    if (activity[i] > soundThreshold[i]) {

      strength[i] =
        activity[i] - noiseFloor[i];

      if (strength[i] > strongestStrength) {

        strongestStrength = strength[i];

        strongest = i;

      }

    }

  }

  if (strongest < 0) {

    lastStrongestMic = 0;

    return false;

  }

  lastStrongestMic = strongest + 1;

  angle = micAngles[strongest];

  // FIND STRONGER ADJACENT MICROPHONE

  int neighbour = -1;

  if (
    strongest > 0 &&
    strength[strongest - 1] > 0
  ) {

    neighbour = strongest - 1;

  }

  if (
    strongest < 3 &&
    strength[strongest + 1] > 0
  ) {

    if (
      neighbour < 0 ||
      strength[strongest + 1] > strength[neighbour]
    ) {

      neighbour = strongest + 1;

    }

  }

  // INTERPOLATE BETWEEN MICROPHONES

  if (neighbour >= 0) {

    float a = strength[strongest];

    float b = strength[neighbour];

    if (a + b > 0) {

      float fraction = b / (a + b);

      angle += fraction *
        (
          micAngles[neighbour] -
          micAngles[strongest]
        );

    }

  }

  angle = constrain(angle, 0.0, 180.0);

  return true;

}


// =====================================================
// START / RECALIBRATE
// =====================================================

void startCalibration() {

  systemStarted = false;

  consecutiveDetections = 0;

  hasPreviousEstimate = false;

  // LED STATUS DURING CALIBRATION

  digitalWrite(LED_SYSTEM, HIGH);
  digitalWrite(LED_DIRECTION, LOW);

  // Keep servo at its existing physical position.

  Serial.println(
    "{\"event\":\"recalibration_started\"}"
  );

  calibrateNoise();

  systemStarted = true;

  resetButtonState();

  updateLEDs();

  Serial.println(
    "{\"event\":\"system_started\"}"
  );

}


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  analogReadResolution(12);

  // MICROPHONE SETUP

  for (int i = 0; i < 4; i++) {

    pinMode(micPins[i], INPUT);

    analogSetPinAttenuation(
      micPins[i],
      ADC_11db
    );

  }

  // BUTTON SETUP

  pinMode(
    BUTTON_PIN,
    INPUT_PULLUP
  );

  resetButtonState();

  // LED SETUP

  pinMode(LED_SYSTEM, OUTPUT);
  pinMode(LED_DIRECTION, OUTPUT);

  digitalWrite(LED_SYSTEM, HIGH);
  digitalWrite(LED_DIRECTION, LOW);

  // SERVO SETUP

  directionServo.setPeriodHertz(50);

  directionServo.attach(
    SERVO_PIN,
    500,
    2400
  );

  currentServoAngle = 90;

  directionServo.write(currentServoAngle);

  delay(1000);

  Serial.println(
    "{\"event\":\"system_ready\",\"message\":\"Automatic calibration starting\"}"
  );

  // AUTOMATIC CALIBRATION ON POWER ON

  startCalibration();

}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {

  // -----------------------------------
  // CHECK BUTTON
  // -----------------------------------

  ButtonEvent event = checkButton();

  if (event == LONG_PRESS) {

    Serial.println(
      "{\"event\":\"button_long_press\"}"
    );

    startCalibration();

    return;

  }

  // -----------------------------------
  // SYSTEM NOT STARTED
  // -----------------------------------

  if (!systemStarted) {

    delay(10);

    return;

  }


  // -----------------------------------
  // LISTEN TO ALL FOUR MICROPHONES
  // -----------------------------------

  unsigned long totals[4] = {0, 0, 0, 0};

  unsigned long windows = 0;

  unsigned long listenStart = millis();

  while (millis() - listenStart < LISTEN_MS) {

    int activity[4];

    readSoundWindow(activity);

    for (int i = 0; i < 4; i++) {

      totals[i] += activity[i];

    }

    windows++;

    // CHECK BUTTON DURING LISTENING

    event = checkButton();

    if (event == LONG_PRESS) {

      Serial.println(
        "{\"event\":\"button_long_press\"}"
      );

      startCalibration();

      return;

    }

  }


  // -----------------------------------
  // CALCULATE AVERAGE ACTIVITY
  // -----------------------------------

  int average[4] = {0, 0, 0, 0};

  for (int i = 0; i < 4; i++) {

    if (windows > 0) {

      average[i] = totals[i] / windows;

    }

  }


  // -----------------------------------
  // ESTIMATE DIRECTION
  // -----------------------------------

  float estimatedAngle = 90.0;

  if (!estimateDirection(average, estimatedAngle)) {

    consecutiveDetections = 0;

    // No direction detected: Yellow OFF

    digitalWrite(LED_DIRECTION, LOW);

    emitTelemetry(
      "no_sound",
      average,
      false,
      0.0
    );

    return;

  }

  consecutiveDetections++;


  // -----------------------------------
  // REQUIRE CONFIRMED DETECTION
  // -----------------------------------

  if (consecutiveDetections < REQUIRED_DETECTIONS) {

    // Sound direction is being confirmed.

    digitalWrite(LED_DIRECTION, HIGH);

    emitTelemetry(
      "confirming",
      average,
      true,
      estimatedAngle
    );

    return;

  }

  consecutiveDetections = 0;


  // -----------------------------------
  // SMOOTH DIRECTION ESTIMATE
  // -----------------------------------

  if (!hasPreviousEstimate) {

    smoothedEstimatedAngle = estimatedAngle;

    hasPreviousEstimate = true;

  }

  else {

    smoothedEstimatedAngle =

      SMOOTHING_FACTOR * estimatedAngle +

      (1.0 - SMOOTHING_FACTOR) *
      smoothedEstimatedAngle;

  }


  // -----------------------------------
  // SERVO MOVEMENT
  // -----------------------------------

  int targetAngle =
    180 -
    (int)(smoothedEstimatedAngle + 0.5);

  targetAngle = constrain(
    targetAngle,
    SERVO_MIN_ANGLE,
    SERVO_MAX_ANGLE
  );

  if (
    abs(targetAngle - currentServoAngle) >=
    MIN_ANGLE_CHANGE
  ) {

    directionServo.write(targetAngle);

    currentServoAngle = targetAngle;

  }


  // -----------------------------------
  // DIRECTION DETECTED: YELLOW ON
  // -----------------------------------

  digitalWrite(LED_SYSTEM, HIGH);
  digitalWrite(LED_DIRECTION, HIGH);


  // -----------------------------------
  // WEBPAGE TELEMETRY
  // -----------------------------------

  emitTelemetry(
    "detected",
    average,
    true,
    smoothedEstimatedAngle
  );

  delay(100);

}
