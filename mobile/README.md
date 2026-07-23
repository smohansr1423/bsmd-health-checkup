# Health Suite — Mobile App

React Native (Expo) mobile companion to the Health Suite desktop app. Integrates
with **Apple HealthKit** to pull vitals directly from Apple Watch and paired
health devices.

---

## Features

| Tab | Function | Apple Watch Data |
|-----|----------|------------------|
| Health Checkup | Senior wellness assessment with auto-fill from Watch | Heart rate, BP, weight, height, glucose |
| Calorie & Cortisol | Daily energy tracking + self-reported stress level | Active/resting calories, steps |
| API Copilot | Offline mock assistant for system documentation | — |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- iOS: Xcode 15+ (for HealthKit — simulator or real device)
- Android: HealthKit features disabled, manual input only

### Install & Run

```bash
cd mobile
npm install

# Run in Expo Go (limited — no HealthKit)
npx expo start

# Run with native modules (required for HealthKit)
npx expo prebuild
npx expo run:ios
```

### Apple Watch / HealthKit Setup

1. Run `npx expo prebuild` to generate the native iOS project
2. Open `ios/` in Xcode
3. Under Signing & Capabilities, ensure **HealthKit** is enabled
4. Build to a real device (HealthKit does not work in simulator with real data)
5. On first launch, the app requests permission to read health data
6. Pair your Apple Watch in the iPhone Health app — data syncs automatically

---

## Project Structure

```
mobile/
├── app/
│   ├── _layout.tsx         # Tab navigation (3 tabs)
│   ├── index.tsx           # Health Checkup screen
│   ├── cortisol.tsx        # Calorie & Cortisol screen
│   └── copilot.tsx         # API Copilot screen
├── src/
│   ├── services/
│   │   ├── healthkit.ts    # Apple HealthKit integration
│   │   ├── storage.ts      # AsyncStorage persistence
│   │   └── assessment.ts   # Health assessment logic
│   └── theme.ts            # Design tokens
├── assets/                 # App icons and splash screen
├── app.json                # Expo config with HealthKit entitlements
└── package.json
```

---

## HealthKit Permissions

The app reads the following data types from Apple Health:

| HealthKit Type | Used For |
|----------------|----------|
| HeartRate | Resting heart rate for checkup |
| BloodPressureSystolic | BP assessment |
| BloodPressureDiastolic | BP assessment |
| Weight | BMI calculation |
| Height | BMI calculation |
| BloodGlucose | Fasting glucose assessment |
| ActiveEnergyBurned | Daily active calories |
| BasalEnergyBurned | Daily resting calories |
| StepCount | Daily step tracking |

The app does **not** write data back to Apple Health.

---

## Offline First

- All data is stored locally using AsyncStorage
- No network requests — works in airplane mode
- No backend server required
- Assessment logic runs entirely on-device

---

## Relationship to Desktop App

This mobile app shares the same assessment logic as the desktop Electron app
(`demo-desktop/`). The mobile version adds:

- Native Apple Watch/HealthKit integration for automatic vital syncing
- Touch-optimized UI for phone use
- Cortisol self-reporting with daily logging
- Same offline-first philosophy

---

## Disclaimer

This is a demonstration tool. Health thresholds are simplified and are **not
medical advice**. It is not a substitute for professional evaluation.
