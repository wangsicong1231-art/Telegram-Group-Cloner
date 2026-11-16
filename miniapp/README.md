# Telegram Mini App

This directory contains the APK's bundled “地推数据采集” web application, with a Telegram Web App SDK adapter. It is separate from the Python/Tkinter desktop application in the repository root.

## Local preview

Serve this directory as the site root so the bundled application can load `/recovered-assets/index-StUqPhvY.js`:

```sh
cd miniapp
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser to preview the interface. Telegram integration is enabled when opened inside Telegram; outside Telegram the bundled app can still display its preview.

## GitHub Pages deployment

The repository includes a workflow that publishes this directory to GitHub Pages when changes are merged to `main`. Enable **Settings → Pages → Build and deployment → GitHub Actions**, then merge the changes and wait for the **Deploy Telegram Mini App** workflow to finish. The site URL is `https://wangsicong1231-art.github.io/Telegram-Group-Cloner/`. Set that URL as the bot's Mini App/menu-button URL in @BotFather.

The asset references support the GitHub Pages repository subpath as well as a root-domain deployment. For other hosting providers, publish the contents of this directory over HTTPS.

## Backend

The APK's UI requires a separately configured HTTPS service for account, upload, review, and finance operations. This repository does not include that service. The UI must only show an operation as complete after the configured service explicitly confirms it.

Telegram's `WebApp.initDataUnsafe` is client-provided context and is not proof of identity. A backend that uses Telegram identity must validate the raw `WebApp.initData` signature server-side before authorizing requests. Do not put a bot token in this static frontend.

The original bundle's asset credits and provenance are retained alongside the extracted assets.
