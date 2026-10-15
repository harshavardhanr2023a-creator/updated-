# Campus Connect (Android)

Offline Android version of the **CampusConnect: Intelligent College FAQ and Navigation Chatbot** Streamlit app.

## Why it is not a straight Python-to-APK conversion
The original app needs PyTorch, `faster-whisper` and a 470 MB sentence-transformer model. None of these can run inside
an APK (python-for-android/Kivy can't package them, and they would make the app gigabytes in size). So the app logic was
ported to JavaScript and runs on the phone, wrapped in a native Android shell:

| Streamlit app | Android app |
|---|---|
| Sentence-transformer FAQ matching | On-device TF-IDF over words + character trigrams (plus location-name synonyms), multilingual, instant, offline |
| Place detection, route cues, "from X to Y" ordering, Google Maps links, unverified-data warnings | Ported 1:1 (`web/nlp.js`), plus typo-tolerant place names |
| Whisper speech-to-text with auto language detection | Android's speech recogniser with a **voice language** picker (English, Tamil, Telugu, Malayalam, Hindi). Typed text still auto-detects the language by script |
| gTTS spoken replies (internet) | Android text-to-speech (works offline if the language's voice is installed) |
| `webbrowser.open` | Opens the Google Maps app |
| `data/faqs.json`, `data/locations.json` | Same files, in `web/data/` |

App size is well under 1 MB of code and data. Needs Android 8.0 (API 26) or newer.

## Build the APK
**Option A: GitHub Actions (no local setup).** Push this folder to a GitHub repo. The *Build Android APK* workflow runs
the tests and builds `app-debug.apk`; download it from the run's *Artifacts*.

**Option B: Android Studio.** Open the `android/` folder, wait for Gradle sync, then *Build > Build APK(s)*.

**Option C: command line.** Install JDK 17+ and the Android SDK (platform 34), set `ANDROID_HOME`, run `./build-apk.sh`.
The APK is written to `dist/CampusConnect.apk`.

Install by copying the APK to the phone and opening it (allow "install unknown apps"), or `adb install dist/CampusConnect.apk`.
The debug APK is signed with a debug key. For a Play Store/release build set `CC_KEYSTORE`, `CC_KEYSTORE_PASSWORD`,
`CC_KEY_ALIAS`, `CC_KEY_PASSWORD` and run `./gradlew assembleRelease` in `android/`.

## Editing content
Edit `web/data/faqs.json` / `web/data/locations.json` (replace the `[PLACEHOLDER]` text and approximate coordinates, then set
`"verified": true`), run `python3 scripts/build_data.py`, and rebuild.
Add example questions in any of the five languages to improve matching.

## Tests
```
node tests/nlp.test.js     # 155 checks: every FAQ question, paraphrases, routes, Indic scripts, typos, nonsense input
node tests/ui.test.js      # needs Playwright + Chromium; drives the UI at phone size with a fake Android bridge
```

## Layout
```
web/       the app (index.html, app.js, nlp.js, style.css, data) - also installable as a PWA when hosted over HTTPS
android/   Gradle project; MainActivity.java hosts the WebView and bridges speech, TTS and links
scripts/   build_data.py
tests/     logic and UI tests
```
