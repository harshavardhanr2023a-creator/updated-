#!/usr/bin/env bash
# Build an installable debug APK. Needs: JDK 17+, Android SDK (ANDROID_HOME set, platform 34), internet for Gradle.
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-}}"
[ -d "${ANDROID_HOME:-/nonexistent}" ] || { echo "Set ANDROID_HOME to your Android SDK (Android Studio: Settings > Android SDK)."; exit 1; }
python3 scripts/build_data.py
(cd android && chmod +x gradlew && ./gradlew --no-daemon assembleDebug)
mkdir -p dist && cp android/app/build/outputs/apk/debug/app-debug.apk dist/CampusConnect.apk
echo "APK ready: dist/CampusConnect.apk"
