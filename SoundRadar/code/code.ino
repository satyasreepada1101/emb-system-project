
#include <ESP32Servo.h>

// =====================================================
// 4-MIC SOUND DIRECTION DETECTION
// ESP32-WROOM-32 + 4 MAX9814 + SG90 SERVO
// PUSH BUTTON: START / RECALIBRATE
// AMPLITUDE-BASED LOCALIZATION (NOT TDOA)
// =====================================================


// ---------------- PIN CONFIGURATION ----------------

const int micPins[4] = {32, 33, 34, 35};

const int SERVO_PIN = 18;
const int BUTTON_PIN = 27;

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


// ---------------- BUTTON ----------------

const unsigned long DEBOUNCE_MS = 50;

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;

unsigned long lastDebounceTime = 0;


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
// PUSH BUTTON WITH DEBOUNCING
// =====================================================

bool buttonPressed() {

  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {

    lastDebounceTime = millis();

  }

  if (millis() - lastDebounceTime > DEBOUNCE_MS) {

    if (reading != stableButtonState) {

      stableButtonState = reading;

      // INPUT_PULLUP: LOW means button pressed

      if (stableButtonState == LOW) {

        lastButtonReading = reading;

        return true;

      }

    }

  }

  lastButtonReading = reading;

  return false;

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

  smoothedEstimatedAngle = 90.0;

  Serial.println(
    "{\"event\":\"calibration_started\"}"
  );

  calibrateNoise();

  systemStarted = true;

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
    "{\"event\":\"system_ready\",\"message\":\"Press button to start calibration\"}"
  );

}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {

  // -----------------------------------
  // CHECK BUTTON
  // -----------------------------------

  if (buttonPressed()) {

    Serial.println(
      "{\"event\":\"button_pressed\"}"
    );

    startCalibration();

  }


  // -----------------------------------
  // WAIT FOR FIRST BUTTON PRESS
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

    if (buttonPressed()) {

      Serial.println(
        "{\"event\":\"button_pressed\"}"
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

  } else {

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
