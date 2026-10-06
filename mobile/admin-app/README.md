# Sky Cars Admin — Android wrapper (Capacitor)

This folder contains the Capacitor project that packages the **existing** admin web app
(`https://skyshcars.com/admin`) as an Android app. It does **not** contain a backend and never stores
credentials: the WebView loads the live HTTPS site and the normal admin login applies.

## Build steps (on a machine with Node + Android Studio)

```bash
cd mobile/admin-app
npm install                 # installs Capacitor
npx cap add android         # creates the android/ project (run once)
npx cap sync android        # copies config + web assets into android/
npx cap open android        # opens Android Studio
```

Then in Android Studio:

- **Debug APK**: Build → Build Bundle(s) / APK(s) → Build APK(s)
- **Release AAB**: Build → Generate Signed Bundle / APK → Android App Bundle (create/select a keystore)

Or from the command line (after `npx cap add android`):

```bash
cd android && ./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
cd android && ./gradlew bundleRelease        # app/build/outputs/bundle/release/app-release.aab
```

## Rules kept by this wrapper

- HTTPS only (`cleartext: false`, `allowMixedContent: false`).
- Production URL `https://skyshcars.com/admin` — backend stays on the web.
- No hardcoded credentials, no auth bypass.
- App name: **Sky Cars Admin**, app id `com.skyshcars.admin`.

If the wrapper ever conflicts with admin authentication, keep using the PWA
("Add to Home screen" from the phone browser) — it needs no build and is fully supported.
