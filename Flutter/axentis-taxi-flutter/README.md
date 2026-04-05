# Axentis Taxi — Flutter Apps Setup Guide

Two Flutter apps are included:

| Folder | App | Default theme |
|---|---|---|
| `driver-app-flutter/` | Driver (DriverUp) | Dark |
| `axentis-taxi-flutter/` | Passenger | Light |

## Requirements

- Flutter 3.19+ / Dart 3.3+
- Android Studio or VS Code with Flutter extension
- Firebase project (one per app, or shared)

---

## 1. Scaffold Android/iOS project files

The source code is complete but Flutter requires platform scaffolding. Run once per app:

```bash
# Driver app
cd driver-app-flutter
flutter create --project-name axentis_driver --org com.axentis . --platforms android,ios

# Passenger app
cd ../axentis-taxi-flutter
flutter create --project-name axentis_taxi --org com.axentis . --platforms android,ios
```

> `flutter create .` fills in missing platform folders (android/, ios/) without overwriting existing Dart files.

---

## 2. Install dependencies

```bash
flutter pub get
```

---

## 3. Firebase setup

For each app:

1. Create an Android app in [Firebase Console](https://console.firebase.google.com/)
   - Driver: package `com.axentis.driverapp`
   - Passenger: package `com.axentis.taxiapp`
2. Download **google-services.json** → place in `android/app/`
3. Add to `android/build.gradle` (project level):
   ```groovy
   dependencies {
     classpath 'com.google.gms:google-services:4.4.0'
   }
   ```
4. Add to `android/app/build.gradle`:
   ```groovy
   apply plugin: 'com.google.gms.google-services'
   ```

---

## 4. Android min SDK

In `android/app/build.gradle` set:

```groovy
android {
    defaultConfig {
        minSdkVersion 23   // required by flutter_secure_storage
        targetSdkVersion 34
    }
}
```

---

## 5. Run

```bash
flutter run
```

---

## Backend

- REST API: `http://84.247.138.53:8181/api/v1`
- WebSocket: `ws://84.247.138.53:8181/ws?user_id={id}`
- Uploads: `http://84.247.138.53:8181/uploads/`

All URLs are in `lib/config/config.dart` — edit there to change environments.

---

## Architecture

```
lib/
  config/        AppConfig constants
  l10n/          Translations (ru/uz) + uzRegions
  models/        Data models (fromJson / copyWith)
  providers/     AuthProvider, ThemeProvider (ChangeNotifier)
  router/        GoRouter with auth guard
  screens/       Login, Register, Home, Profile
  services/      ApiService (Dio), SocketService (WS), NotificationService
```

## Key behaviours

| Feature | Implementation |
|---|---|
| Maps | flutter_map + OpenStreetMap (no API key needed) |
| Routing | OSRM `project-osrm.org` (free, no key) |
| GPS smooth display | "Refs pattern": GPS writes to instance vars, 20ms AnimationController reads and smooths (alpha=0.35) |
| Driver tracking (passenger) | `driver_location` WS events → exponential lerp alpha=0.18, angular shortest-path wrap |
| Auth token | flutter_secure_storage (persists across restarts) |
| Pricing formula | `ceil((serviceFee + ceil(dist_m/100)*100/1000 * pricePerKm * surge) / 200) * 200` |
| WebSocket reconnect | Auto-reconnect after 3s, 20s ping keepalive |
