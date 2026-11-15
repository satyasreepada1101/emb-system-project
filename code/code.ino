
#include <ESP32Servo.h>

// =====================================================
// 4-MIC SOUND DIRECTION DETECTION
// ESP32-WROOM-32 + 4 MAX9814 + SG90 SERVO
//
// IMPROVED LOGIC:
// 1. Individual noise calibration
// 2. Normalized microphone strength
// 3. Weighted angle estimation
// 4. Adjacent microphone interpolation
// 5. Endpoint handling
// 6. Adaptive smoothing
//
// BUTTON:
// LONG PRESS  = RECALIBRATE
//
// GREEN LED  = SYSTEM ACTIVE
// YELLOW LED = SOUND DETECTED / PAUSED
//
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
const int NUM_WINDOWS = 150;

const int MIN_THRESHOLD = 180;
const int MIN_NOISE_MARGIN = 100;

const float NOISE_MULTIPLIER = 1.35;


// ---------------- MICROPHONE CORRECTION ----------------

// Initially equal. Tune after testing all microphones.

float micGain[4] = {
  1.0, 1.0, 1.0, 1.0
};


// ---------------- LISTENING ----------------

const unsigned long LISTEN_MS = 600;


// ---------------- DETECTION ----------------

const float MIN_DETECTION_STRENGTH = 40.0;

const float NEIGHBOUR_MIN_RATIO = 0.12;

const float ENDPOINT_DOMINANCE_RATIO = 1.20;

const int REQUIRED_DETECTIONS = 2;


// ---------------- SMOOTHING ----------------

const float SMOOTHING_NORMAL = 0.35;
const float SMOOTHING_FAST = 0.75;

const float FAST_CHANGE_ANGLE = 25.0;

const float MIN_ANGLE_CHANGE = 3.0;


// ---------------- SERVO ----------------

const int SERVO_MIN_ANGLE = 10;
const int SERVO_MAX_ANGLE = 170;


// ---------------- BUTTON ----------------

const unsigned long DEBOUNCE_MS = 50;
const unsigned long LONG_PRESS_MS = 2000;

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;

unsigned long lastDebounceTime = 0;
unsigned long buttonPressStart = 0;
unsigned long lastButtonUpdateTime = 0;

bool longPressHandled = false;


enum ButtonEvent {
  NO_EVENT,
  LONG_PRESS
};


// ---------------- SYSTEM STATE ----------------

bool systemStarted = false;
bool directionDetected = false;

Servo directionServo;

int currentServoAngle = 90;

float smoothedEstimatedAngle = 90.0;

bool hasPreviousEstimate = false;

int consecutiveDetections = 0;

int lastStrongestMic = 0;


// ---------------- CALIBRATION DATA ----------------

int noiseFloor[4] = {0, 0, 0, 0};
int soundThreshold[4] = {0, 0, 0, 0};


// =====================================================
// LED CONTROL
// =====================================================

void updateLEDs() {

  digitalWrite(LED_SYSTEM, HIGH);

  if (!systemStarted) {

    digitalWrite(LED_DIRECTION, LOW);
    return;

  }

  digitalWrite(
    LED_DIRECTION,
    directionDetected ? HIGH : LOW
  );

}


// =====================================================
// TELEMETRY
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
  float angle,
  const float strength[4]
) {

  Serial.printf(
    "{\"event\":\"%s\",\"detected\":%s,"
    "\"strongestMic\":%d,\"angle\":",

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
    ",\"smoothedAngle\":%.1f,"
    "\"servoAngle\":%d,"
    "\"mics\":[%d,%d,%d,%d],"
    "\"strength\":[%.1f,%.1f,%.1f,%.1f],"
    "\"noiseFloor\":[%d,%d,%d,%d],"
    "\"thresholds\":[%d,%d,%d,%d]}\n",

    smoothedEstimatedAngle,
    currentServoAngle,

    activity[0], activity[1],
    activity[2], activity[3],

    strength[0], strength[1],
    strength[2], strength[3],

    noiseFloor[0], noiseFloor[1],
    noiseFloor[2], noiseFloor[3],

    soundThreshold[0], soundThreshold[1],
    soundThreshold[2], soundThreshold[3]
  );

}


// =====================================================
// BUTTON RESET
// =====================================================

void resetButtonState() {

  lastButtonReading = digitalRead(BUTTON_PIN);
  stableButtonState = lastButtonReading;

  lastDebounceTime = millis();

  buttonPressStart = millis();
  lastButtonUpdateTime = buttonPressStart;

  longPressHandled = (stableButtonState == LOW);

}


// =====================================================
// BUTTON HANDLING
// =====================================================

ButtonEvent checkButton() {

  bool reading = digitalRead(BUTTON_PIN);

  ButtonEvent event = NO_EVENT;

  if (reading != lastButtonReading) {

    lastDebounceTime = millis();
    lastButtonReading = reading;

  }

  if (millis() - lastDebounceTime >= DEBOUNCE_MS) {

    if (reading != stableButtonState) {

      stableButtonState = reading;

      if (stableButtonState == LOW) {

        buttonPressStart = millis();
        lastButtonUpdateTime = buttonPressStart;

        longPressHandled = false;

        Serial.println(
          "{\"event\":\"button_pressed\"}"
        );

      } else {

        unsigned long duration =
          millis() - buttonPressStart;

        Serial.printf(
          "{\"event\":\"button_released\","
          "\"durationMs\":%lu}\n",
          duration
        );

      }

    }

  }

  if (
    stableButtonState == LOW &&
    !longPressHandled &&
    millis() - lastButtonUpdateTime >= 100
  ) {

    lastButtonUpdateTime = millis();

    unsigned long duration =
      millis() - buttonPressStart;

    int progress = min(
      100UL,
      duration * 100UL / LONG_PRESS_MS
    );

    Serial.printf(
      "{\"event\":\"button_hold\","
      "\"durationMs\":%lu,\"holdProgress\":%d}\n",
      duration,
      progress
    );

  }

  if (
    stableButtonState == LOW &&
    !longPressHandled &&
    millis() - buttonPressStart >= LONG_PRESS_MS
  ) {

    longPressHandled = true;

    return LONG_PRESS;

  }

  return event;

}


// =====================================================
// READ MICROPHONE WINDOW
// =====================================================

void readSoundWindow(int activity[4]) {

  int minVal[4] = {
    4095, 4095, 4095, 4095
  };

  int maxVal[4] = {
    0, 0, 0, 0
  };

  unsigned long start = millis();

  while (millis() - start < WINDOW_MS) {

    for (int i = 0; i < 4; i++) {

      int value = analogRead(micPins[i]);

      if (value < minVal[i]) {
        minVal[i] = value;
      }

      if (value > maxVal[i]) {
        maxVal[i] = value;
      }

    }

  }

  for (int i = 0; i < 4; i++) {

    activity[i] = maxVal[i] - minVal[i];

  }

}


// =====================================================
// SORT CALIBRATION SAMPLES
// =====================================================

void sortSamples(int values[], int count) {

  for (int i = 1; i < count; i++) {

    int key = values[i];
    int j = i - 1;

    while (j >= 0 && values[j] > key) {

      values[j + 1] = values[j];
      j--;

    }

    values[j + 1] = key;

  }

}


// =====================================================
// CALIBRATION
// =====================================================

void calibrateNoise() {

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
        (n + 1) * 100 / NUM_WINDOWS
      );

    }

    long remaining =
      (long)(CALIBRATION_MS / NUM_WINDOWS)
      - (long)WINDOW_MS;

    if (remaining > 0) {
      delay(remaining);
    }

  }

  for (int mic = 0; mic < 4; mic++) {

    sortSamples(samples[mic], NUM_WINDOWS);

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

  Serial.printf(
    "{\"event\":\"calibration_values\","
    "\"noiseFloor\":[%d,%d,%d,%d],"
    "\"thresholds\":[%d,%d,%d,%d]}\n",

    noiseFloor[0], noiseFloor[1],
    noiseFloor[2], noiseFloor[3],

    soundThreshold[0], soundThreshold[1],
    soundThreshold[2], soundThreshold[3]
  );

  emitCalibration(100);

  Serial.println(
    "{\"event\":\"calibration_complete\"}"
  );

}


// =====================================================
// NORMALIZE MICROPHONE STRENGTH
// =====================================================

void calculateStrength(
  const int activity[4],
  float strength[4]
) {

  for (int i = 0; i < 4; i++) {

    if (activity[i] <= soundThreshold[i]) {

      strength[i] = 0;
      continue;

    }

    strength[i] =
      (activity[i] - soundThreshold[i]) *
      micGain[i];

  }

}


// =====================================================
// IMPROVED DIRECTION ESTIMATION
// =====================================================

bool estimateDirection(
  const int activity[4],
  float &angle,
  float &confidence,
  float strength[4]
) {

  calculateStrength(activity, strength);

  int strongest = -1;

  float maximum = 0;

  float total = 0;

  for (int i = 0; i < 4; i++) {

    total += strength[i];

    if (strength[i] > maximum) {

      maximum = strength[i];
      strongest = i;

    }

  }

  if (
    strongest < 0 ||
    maximum < MIN_DETECTION_STRENGTH
  ) {

    lastStrongestMic = 0;
    confidence = 0;

    return false;

  }

  lastStrongestMic = strongest + 1;

  confidence = maximum;


  // -----------------------------------
  // SINGLE MIC DOMINANCE
  // -----------------------------------

  float left = (
    strongest > 0
  ) ? strength[strongest - 1] : 0;

  float right = (
    strongest < 3
  ) ? strength[strongest + 1] : 0;


  // MIC 1 ENDPOINT

  if (
    strongest == 0 &&
    (right == 0 || maximum >=
     right * ENDPOINT_DOMINANCE_RATIO)
  ) {

    angle = 0;
    return true;

  }


  // MIC 4 ENDPOINT

  if (
    strongest == 3 &&
    (left == 0 || maximum >=
     left * ENDPOINT_DOMINANCE_RATIO)
  ) {

    angle = 180;
    return true;

  }


  // -----------------------------------
  // USE ONLY LOCAL NEIGHBOURS
  // -----------------------------------

  float leftWeight = 0;
  float centerWeight = strength[strongest];
  float rightWeight = 0;

  if (strongest > 0) {

    if (left >= maximum * NEIGHBOUR_MIN_RATIO) {

      leftWeight = left;

    }

  }

  if (strongest < 3) {

    if (right >= maximum * NEIGHBOUR_MIN_RATIO) {

      rightWeight = right;

    }

  }


  // -----------------------------------
  // WEIGHTED LOCAL ESTIMATION
  // -----------------------------------

  float weightedAngle =
      centerWeight * micAngles[strongest];

  float totalWeight = centerWeight;


  if (leftWeight > 0) {

    weightedAngle +=
      leftWeight * micAngles[strongest - 1];

    totalWeight += leftWeight;

  }

  if (rightWeight > 0) {

    weightedAngle +=
      rightWeight * micAngles[strongest + 1];

    totalWeight += rightWeight;

  }


  angle = weightedAngle / totalWeight;


  // -----------------------------------
  // STRONGEST MIC CENTRE ANCHOR
  // -----------------------------------

  // Keep the estimate within the local
  // region of the strongest microphone.

  float lower = 0;
  float upper = 180;

  if (strongest > 0) {

    lower =
      (micAngles[strongest - 1] +
       micAngles[strongest]) / 2.0;

  }

  if (strongest < 3) {

    upper =
      (micAngles[strongest] +
       micAngles[strongest + 1]) / 2.0;

  }

  angle = constrain(
    angle,
    lower,
    upper
  );

  return true;

}


// =====================================================
// ADAPTIVE SMOOTHING
// =====================================================

float smoothAngle(float newAngle) {

  if (!hasPreviousEstimate) {

    smoothedEstimatedAngle = newAngle;

    hasPreviousEstimate = true;

    return newAngle;

  }

  float difference =
    abs(newAngle - smoothedEstimatedAngle);

  float alpha = SMOOTHING_NORMAL;

  if (difference >= FAST_CHANGE_ANGLE) {

    alpha = SMOOTHING_FAST;

  }

  smoothedEstimatedAngle =
    alpha * newAngle +
    (1.0 - alpha) * smoothedEstimatedAngle;

  smoothedEstimatedAngle = constrain(
    smoothedEstimatedAngle,
    0.0,
    180.0
  );

  return smoothedEstimatedAngle;

}


// =====================================================
// SERVO MOVEMENT
// =====================================================

void moveServoToDirection(float angle) {

  int targetAngle =
    180 - (int)(angle + 0.5);

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

}


// =====================================================
// START / RECALIBRATE
// =====================================================

void startCalibration() {

  systemStarted = false;
  directionDetected = false;

  consecutiveDetections = 0;

  hasPreviousEstimate = false;

  smoothedEstimatedAngle = 90;

  lastStrongestMic = 0;

  digitalWrite(LED_SYSTEM, HIGH);
  digitalWrite(LED_DIRECTION, LOW);

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

  for (int i = 0; i < 4; i++) {

    pinMode(micPins[i], INPUT);

    analogSetPinAttenuation(
      micPins[i],
      ADC_11db
    );

  }

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  pinMode(LED_SYSTEM, OUTPUT);
  pinMode(LED_DIRECTION, OUTPUT);

  digitalWrite(LED_SYSTEM, HIGH);
  digitalWrite(LED_DIRECTION, LOW);

  resetButtonState();

  directionServo.setPeriodHertz(50);

  directionServo.attach(
    SERVO_PIN,
    500,
    2400
  );

  currentServoAngle = 90;

  directionServo.write(90);

  delay(1000);

  Serial.println(
    "{\"event\":\"system_ready\","
    "\"message\":\"Automatic calibration starting\"}"
  );

  startCalibration();

}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {

  ButtonEvent event = checkButton();


  // LONG PRESS = RECALIBRATION

  if (event == LONG_PRESS) {

    Serial.println(
      "{\"event\":\"button_long_press\"}"
    );

    startCalibration();

    return;

  }


  if (!systemStarted) {

    delay(10);
    return;

  }


  // -----------------------------------
  // COLLECT SOUND WINDOWS
  // -----------------------------------

  unsigned long totals[4] = {
    0, 0, 0, 0
  };

  unsigned long windows = 0;

  unsigned long listenStart = millis();

  while (millis() - listenStart < LISTEN_MS) {

    int activity[4];

    readSoundWindow(activity);

    for (int i = 0; i < 4; i++) {

      totals[i] += activity[i];

    }

    windows++;

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
  // AVERAGE ACTIVITY
  // -----------------------------------

  int average[4] = {
    0, 0, 0, 0
  };

  for (int i = 0; i < 4; i++) {

    if (windows > 0) {

      average[i] = totals[i] / windows;

    }

  }


  // -----------------------------------
  // ESTIMATE DIRECTION
  // -----------------------------------

  float estimatedAngle = 90;

  float confidence = 0;

  float strength[4] = {
    0, 0, 0, 0
  };


  if (
    !estimateDirection(
      average,
      estimatedAngle,
      confidence,
      strength
    )
  ) {

    consecutiveDetections = 0;

    directionDetected = false;

    updateLEDs();

    emitTelemetry(
      "no_sound",
      average,
      false,
      0,
      strength
    );

    return;

  }


  // -----------------------------------
  // CONFIRM DETECTION
  // -----------------------------------

  consecutiveDetections++;

  if (
    consecutiveDetections < REQUIRED_DETECTIONS
  ) {

    directionDetected = true;

    updateLEDs();

    emitTelemetry(
      "confirming",
      average,
      true,
      estimatedAngle,
      strength
    );

    return;

  }

  consecutiveDetections = 0;


  // -----------------------------------
  // SMOOTH ANGLE
  // -----------------------------------

  float finalAngle = smoothAngle(
    estimatedAngle
  );


  // -----------------------------------
  // SERVO
  // -----------------------------------

  moveServoToDirection(finalAngle);


  // -----------------------------------
  // LEDS
  // -----------------------------------

  directionDetected = true;

  updateLEDs();


  // -----------------------------------
  // WEBPAGE TELEMETRY
  // -----------------------------------

  emitTelemetry(
    "detected",
    average,
    true,
    finalAngle,
    strength
  );

}
