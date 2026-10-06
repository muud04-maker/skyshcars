# Sky Cars Admin — phone app (PWA) and optional Android wrapper

## 1. Install the admin on your phone (works today, no build required)

The admin is now an installable PWA (`/admin`):

1. On the phone, open **https://skyshcars.com/admin** in Chrome (Android) or Safari (iPhone).
2. Log in as admin.
3. Android (Chrome): menu **⋮ → Add to Home screen / Install app**.
   iPhone (Safari): **Share → Add to Home Screen**.
4. Launch it from the home screen — it opens full screen (standalone) with its own icon and the
   6-tab mobile bar: Dashboard · Inbox · Inventory · Add car · Quotes · More.

Files that make this work:

- `public/manifest-admin.webmanifest` (name, `start_url: /admin`, standalone, theme colour)
- `public/icon-admin.svg` (app icon)
- `src/app/admin/layout.tsx` (links the manifest, safe-area viewport, Apple web-app meta)
- `src/app/admin/_components/AdminTabBar.tsx` (phone navigation)
- `src/app/inbox.css` (mobile layout + safe-area padding)

Security: the PWA is only a shell around the normal website. It uses the same HTTPS admin login and
the same session cookie. Nothing is stored in the app, and no credentials are embedded.

## 2. Optional: wrap the PWA in a real Android APK/AAB (Capacitor)

This environment cannot build an Android package (no Android SDK / Gradle / network here), so the
APK step is **not done**. The wrapper is optional — the PWA already installs to the home screen.

To build the APK on your own machine:

```bash
# from the repository root
mkdir -p mobile/admin-app && cd mobile/admin-app
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Sky Cars Admin" com.skyshcars.admin --web-dir=www
mkdir -p www
cat > www/index.html <<'HTML'
<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="refresh" content="0; url=https://skyshcars.com/admin">
</head><body style="font-family:system-ui;background:#071b2d;color:#fff;text-align:center;padding-top:40vh">
Opening Sky Cars Admin…
<script>location.replace('https://skyshcars.com/admin');</script>
</body></html>
HTML
npx cap add android
npx cap sync android
npx cap open android      # opens Android Studio; then Build > Build Bundle(s)/APK(s)
```

Keep in mind:

- `server.url` must stay `https://skyshcars.com/admin` (HTTPS only). Never bundle credentials.
- Do not disable or bypass the admin login — the WebView simply loads the secure site.
- Rebuild the APK only when the URL or app icon changes; content updates happen on the server.

If wrapping ever conflicts with admin authentication, stay on the PWA (it is fully supported).
