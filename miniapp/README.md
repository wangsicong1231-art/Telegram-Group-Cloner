# Telegram Mini App

This directory contains the Telegram Mini App. The redesigned `index.html` is a data-collection and notifications dashboard; the existing bundled collection application remains available at `workbench.html`. It is separate from the Python/Tkinter desktop application in the repository root.

## Local preview

Serve this directory as the site root:

```sh
cd miniapp
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser to preview the dashboard. The legacy collection workbench is at `http://localhost:8000/workbench.html`.

## GitHub Pages deployment

The repository includes a workflow that publishes this directory to GitHub Pages when changes are merged to `main`. Enable **Settings → Pages → Build and deployment → GitHub Actions**, then merge the changes and wait for the **Deploy Telegram Mini App** workflow to finish. The site URL is `https://wangsicong1231-art.github.io/Telegram-Group-Cloner/`. Set that URL as the bot's Mini App/menu-button URL in @BotFather.

The asset references support the GitHub Pages repository subpath as well as a root-domain deployment. For other hosting providers, publish the contents of this directory over HTTPS.

GitHub Pages publishes only static files and cannot run `backend.py`; the `/admin` console and activation APIs require the Python service below. Do not treat a Pages-only deployment as a live admin backend.

## Configuration backend

The Python service serves both the Mini App and the administrator console at `/admin`. It stores the public group URL, up to eight ticker messages, activation-code hashes, and verified device bindings in SQLite. The admin console can generate up to 25 one-time activation codes per batch, set their expiry, revoke unused codes, and review or unbind Telegram accounts. Codes contain 128 bits of randomness; the plaintext is shown once and is never stored.

Install the service dependencies and configure secrets outside the repository:

```sh
cd miniapp
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export MINIAPP_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export MINIAPP_ADMIN_PASSWORD='use-a-unique-password-of-at-least-16-characters'
export MINIAPP_TELEGRAM_BOT_TOKEN='set-the-token-from-BotFather'
export MINIAPP_COOKIE_SECURE=false
python3 backend.py
```

Open `http://localhost:8080/admin` for local testing. `MINIAPP_COOKIE_SECURE=false` is only for localhost; keep it at the default `true` in production and terminate HTTPS at a trusted reverse proxy. For production, run the app with Waitress rather than Flask's development server:

```sh
.venv/bin/waitress-serve --call --host=127.0.0.1 --port=8080 backend:create_app
```

Set `MINIAPP_SECRET_KEY`, `MINIAPP_ADMIN_PASSWORD`, and `MINIAPP_TELEGRAM_BOT_TOKEN` in the service manager's secret environment, not in source files or the public `app-config.js`. The admin password must be at least 16 characters. The database defaults to `~/.local/share/telegram-group-cloner-miniapp/admin.sqlite3`; `MINIAPP_DATA_DIR` can point to another private, persistent directory outside the web root.

The binding API verifies Telegram's signed `WebApp.initData` on the server, checks code expiry and one-time use, then reports the account's binding state to the Mini App. The frontend keeps all features gated until that API confirms a binding. Activation requires a valid BotFather token and HTTPS deployment. The administrator console must only be exposed over HTTPS.

The admin console currently configures the public group URL and ticker messages. Earnings totals, collection records, activation counts, live collection notifications, and payout-method submission/storage still need the corresponding business data services. The WeChat/Alipay QR picker only provides local preview, and USDT details are not sent or saved. The fixed “公群老板 @hccck” label is not configurable.

The home page no longer links to the collection workbench. It accepts only HTTPS links on `t.me` or `telegram.me`; the read-only “公群老板 @hccck” label is fixed at the bottom of the dashboard. The existing bundled workbench separately requires a configured HTTPS service for account, upload, review, and finance operations.

The dashboard can display Telegram client profile context, but does not treat `WebApp.initDataUnsafe` as authenticated identity. Telegram account authorization requires the server to validate the raw `WebApp.initData` signature. No earnings, collection, notification, or payout APIs are included; the UI must only show an operation as complete after a service explicitly confirms it.

The original bundle's asset credits and provenance are retained alongside the extracted assets.
