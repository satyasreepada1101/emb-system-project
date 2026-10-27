
#include <ESP32Servo.h>

// =====================================================
// 4-MIC SOUND DIRECTION DETECTION
// ESP32-WROOM-32 + 4 MAX9814 + SG90 SERVO
// Amplitude-based localization (NOT TDOA)
// =====================================================

// ---------------- PIN CONFIGURATION ----------------
const int micPins[4] = {32, 33, 34, 35};
const int SERVO_PIN = 18;

// Physical direction assigned to each microphone
// Confirm this mapping against your actual arrangement.
const float micAngles[4] = {0.0, 60.0, 120.0, 180.0};

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

// ---------------- SERVO STATE ----------------
Servo directionServo;

int currentServoAngle = 90;
float smoothedEstimatedAngle = 90.0;

bool hasPreviousEstimate = false;
int consecutiveDetections = 0;

// ---------------- MIC CALIBRATION ----------------
int noiseFloor[4] = {0, 0, 0, 0};
int soundThreshold[4] = {0, 0, 0, 0};

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
void calibrateNoise() {
  const int NUM_WINDOWS = 150;

  int samples[4][NUM_WINDOWS];

  Serial.println();
  Serial.println("====================================");
  Serial.println("MICROPHONE NOISE CALIBRATION");
  Serial.println("Duration: approximately 30 seconds");
  Serial.println("Keep normal room background noise.");
  Serial.println("Avoid clapping or deliberate test sounds.");
  Serial.println("====================================");

  for (int n = 0; n < NUM_WINDOWS; n++) {
    int activity[4];

    readSoundWindow(activity);

    for (int mic = 0; mic < 4; mic++) {
      samples[mic][n] = activity[mic];
    }

    if ((n + 1) % 25 == 0) {
      Serial.printf(
        "Calibration progress: %d%%\n",
        ((n + 1) * 100) / NUM_WINDOWS
      );
    }

    // Spread the calibration across roughly 30 seconds.
    delay(max(0L, (long)(CALIBRATION_MS / NUM_WINDOWS)
                       - (long)WINDOW_MS));
  }

  // Sort each microphone's calibration values.
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

    noiseFloor[mic] = samples[mic][NUM_WINDOWS / 2];

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

  Serial.println("Calibration complete.");
  Serial.println("Amplitude-based direction detection active.");
}

// ---------------- DIRECTION ESTIMATION ----------------
bool estimateDirection(const int activity[4], float &angle) {
  float strength[4] = {0, 0, 0, 0};

  int strongest = -1;
  float strongestStrength = 0;

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

  return true;
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

  directionServo.setPeriodHertz(50);
  directionServo.attach(SERVO_PIN, 500, 2400);

  currentServoAngle = 90;
  directionServo.write(currentServoAngle);

  delay(1000);

  Serial.println();
  Serial.println("4-MIC SOUND DIRECTION PROJECT");
  Serial.println("ESP32 + MAX9814 + SG90");
  Serial.println("Servo initialized at 90 degrees.");

  calibrateNoise();
}

// ---------------- MAIN LOOP ----------------
void loop() {
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
  }

  int average[4] = {0, 0, 0, 0};

  for (int i = 0; i < 4; i++) {
    if (windows > 0) {
      average[i] = totals[i] / windows;
    }
  }

  Serial.printf(
    "\nM1:%d (T:%d) | M2:%d (T:%d) | "
    "M3:%d (T:%d) | M4:%d (T:%d)\n",
    average[0], soundThreshold[0],
    average[1], soundThreshold[1],
    average[2], soundThreshold[2],
    average[3], soundThreshold[3]
  );

  float estimatedAngle = 90.0;

  if (!estimateDirection(average, estimatedAngle)) {
    consecutiveDetections = 0;

    Serial.println("No qualifying sound detected.");
    Serial.printf("Servo HOLDING at %d degrees\n",
                  currentServoAngle);
    return;
  }

  consecutiveDetections++;

  Serial.printf(
    "Estimated direction: %.1f degrees\n",
    estimatedAngle
  );

  // Require consecutive qualifying windows before moving.
  if (consecutiveDetections < REQUIRED_DETECTIONS) {
    Serial.println("Confirming sound direction...");
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

  if (abs(targetAngle - currentServoAngle) >= MIN_ANGLE_CHANGE) {
    directionServo.write(targetAngle);
    currentServoAngle = targetAngle;
    Serial.println("Servo moved.");
  } else {
    Serial.println("Small change; servo held.");
  }

  delay(100);
}
