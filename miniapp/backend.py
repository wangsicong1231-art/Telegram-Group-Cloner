from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qsl

from flask import Flask, current_app, g, jsonify, request, send_from_directory, session


MINIAPP_DIR = Path(__file__).resolve().parent
CODE_PATTERN = re.compile(r"^[A-F0-9]{32}$")
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 15 * 60
SESSION_LIFETIME_SECONDS = 8 * 60 * 60
TELEGRAM_AUTH_MAX_AGE_SECONDS = 60 * 60


def _utc_timestamp() -> int:
    return int(time.time())


def _format_timestamp(timestamp: int | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def _connect_database() -> sqlite3.Connection:
    connection = sqlite3.connect(current_app.config["DATABASE"], timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _initialize_database(database_path: str) -> None:
    if database_path != ":memory:":
        database_directory = Path(database_path).parent
        database_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = sqlite3.connect(database_path)
    try:
        connection.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS activation_codes (
                id TEXT PRIMARY KEY,
                code_hash TEXT NOT NULL UNIQUE,
                code_hint TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                used_at INTEGER,
                used_by TEXT,
                revoked_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS device_bindings (
                telegram_user_id TEXT PRIMARY KEY,
                activation_code_id TEXT NOT NULL UNIQUE
                    REFERENCES activation_codes(id),
                bound_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_attempts (
                remote_address TEXT PRIMARY KEY,
                attempts INTEGER NOT NULL,
                window_started_at INTEGER NOT NULL,
                locked_until INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)",
            ("publicGroupUrl", '""'),
        )
        connection.execute(
            "INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)",
            ("announcementMessages", "[]"),
        )
        connection.commit()
    finally:
        connection.close()
    if database_path != ":memory:":
        os.chmod(database_path, 0o600)


def _get_database() -> sqlite3.Connection:
    if "database" not in g:
        g.database = _connect_database()
    return g.database


def _json_body() -> dict[str, Any]:
    if not request.is_json:
        raise ValueError("请求必须使用 JSON 格式。")
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ValueError("请求内容必须是有效的 JSON 对象。")
    return body


def _admin_required(handler: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(handler)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        if not session.get("admin_authenticated"):
            return jsonify(error="请先登录管理员账号。"), 401
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            supplied_token = request.headers.get("X-CSRF-Token", "")
            expected_token = session.get("csrf_token", "")
            if not expected_token or not hmac.compare_digest(supplied_token, expected_token):
                return jsonify(error="安全令牌已失效，请重新登录。"), 403
        return handler(*args, **kwargs)

    return wrapped


def _valid_group_url(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("公群链接必须是文本。")
    value = value.strip()
    if not value:
        return ""
    if len(value) > 2048:
        raise ValueError("公群链接长度不能超过 2048 个字符。")
    from urllib.parse import urlparse

    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in {"t.me", "telegram.me"}
        or parsed.path in {"", "/"}
        or parsed.username
        or parsed.password
        or parsed.port
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("公群链接仅支持 https://t.me/... 或 https://telegram.me/... 格式。")
    return value


def _validate_announcements(value: Any) -> list[str]:
    if not isinstance(value, list) or len(value) > 8:
        raise ValueError("循环播报最多配置 8 条内容。")
    messages = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError("每条播报必须是文本。")
        message = item.strip()
        if not message or len(message) > 120:
            raise ValueError("播报内容不能为空，且每条最多 120 个字符。")
        messages.append(message)
    return messages


def _activation_code() -> str:
    raw = secrets.token_hex(16).upper()
    return "-".join(raw[index : index + 4] for index in range(0, len(raw), 4))


def _code_digest(code: str) -> str:
    normalized = re.sub(r"[-\s]", "", code).upper()
    if not CODE_PATTERN.fullmatch(normalized):
        raise ValueError("激活码格式无效。")
    return hashlib.sha256(normalized.encode("ascii")).hexdigest()


def _verify_telegram_init_data(init_data: Any) -> dict[str, Any]:
    bot_token = current_app.config.get("TELEGRAM_BOT_TOKEN", "")
    if not bot_token:
        raise RuntimeError("后台尚未配置 Telegram Bot Token，设备激活功能不可用。")
    if not isinstance(init_data, str) or not init_data:
        raise ValueError("请从 Telegram 小程序内完成设备绑定。")

    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
        if len({key for key, _ in pairs}) != len(pairs):
            raise ValueError("Telegram 会话数据包含重复字段。")
        values = dict(pairs)
        supplied_hash = values.pop("hash")
        auth_date = int(values["auth_date"])
        user = json.loads(values["user"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("Telegram 会话数据无效，请重新打开小程序。") from error

    now = _utc_timestamp()
    if auth_date > now + 60 or now - auth_date > TELEGRAM_AUTH_MAX_AGE_SECONDS:
        raise ValueError("Telegram 会话已过期，请重新打开小程序。")

    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated_hash, supplied_hash):
        raise ValueError("Telegram 会话校验失败。")

    if not isinstance(user, dict) or not isinstance(user.get("id"), (str, int)):
        raise ValueError("Telegram 用户信息无效。")
    return user


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    data_dir = Path(
        os.environ.get(
            "MINIAPP_DATA_DIR",
            Path.home() / ".local" / "share" / "telegram-group-cloner-miniapp",
        )
        or Path.home() / ".local" / "share" / "telegram-group-cloner-miniapp"
    ).resolve()
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("MINIAPP_SECRET_KEY", ""),
        ADMIN_PASSWORD=os.environ.get("MINIAPP_ADMIN_PASSWORD", ""),
        TELEGRAM_BOT_TOKEN=os.environ.get("MINIAPP_TELEGRAM_BOT_TOKEN", ""),
        DATABASE=str(data_dir / "admin.sqlite3"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
        SESSION_COOKIE_SECURE=os.environ.get("MINIAPP_COOKIE_SECURE", "true").lower() != "false",
        PERMANENT_SESSION_LIFETIME=SESSION_LIFETIME_SECONDS,
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    if not isinstance(app.config["SECRET_KEY"], str) or len(app.config["SECRET_KEY"]) < 32:
        raise RuntimeError("请通过 MINIAPP_SECRET_KEY 配置至少 32 个字符的随机会话密钥。")
    if len(app.config["ADMIN_PASSWORD"]) < 16:
        raise RuntimeError("请通过 MINIAPP_ADMIN_PASSWORD 配置至少 16 位的管理员密码。")
    database_path = Path(app.config["DATABASE"]).resolve()
    if MINIAPP_DIR == database_path or MINIAPP_DIR in database_path.parents:
        raise RuntimeError("数据库必须保存在 Mini App 静态文件目录之外。")
    app.config["DATABASE"] = str(database_path)

    _initialize_database(app.config["DATABASE"])

    @app.teardown_appcontext
    def close_database(_: BaseException | None = None) -> None:
        connection = g.pop("database", None)
        if connection is not None:
            connection.close()

    @app.after_request
    def security_headers(response: Any) -> Any:
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        if request.path.startswith("/api/") or request.path.startswith("/admin"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def dashboard() -> Any:
        return send_from_directory(MINIAPP_DIR, "index.html")

    @app.get("/admin")
    @app.get("/admin/")
    def admin_page() -> Any:
        return send_from_directory(MINIAPP_DIR, "admin.html")

    @app.get("/<path:asset_path>")
    def static_assets(asset_path: str) -> Any:
        if asset_path not in {
            "app-config.js",
            "cordova.js",
            "cordova_plugins.js",
            "index.html",
            "telegram-webapp.js",
            "workbench.html",
        } and not asset_path.startswith(("assets/", "recovered-assets/")):
            return jsonify(error="未找到文件。"), 404
        return send_from_directory(MINIAPP_DIR, asset_path)

    @app.get("/api/health")
    def health() -> Any:
        return jsonify(status="ok")

    @app.get("/api/miniapp/config")
    def miniapp_config() -> Any:
        connection = _get_database()
        rows = connection.execute(
            "SELECT key, value FROM app_config WHERE key IN (?, ?)",
            ("publicGroupUrl", "announcementMessages"),
        ).fetchall()
        config = {row["key"]: json.loads(row["value"]) for row in rows}
        return jsonify(
            publicGroupUrl=config.get("publicGroupUrl", ""),
            announcementMessages=config.get("announcementMessages", []),
        )

    @app.post("/api/miniapp/state")
    def miniapp_state() -> Any:
        try:
            body = _json_body()
            user = _verify_telegram_init_data(body.get("initData"))
        except RuntimeError as error:
            return jsonify(error=str(error)), 503
        except ValueError as error:
            return jsonify(error=str(error)), 401
        bound = _get_database().execute(
            "SELECT 1 FROM device_bindings WHERE telegram_user_id = ?",
            (str(user["id"]),),
        ).fetchone()
        return jsonify(deviceBound=bound is not None)

    @app.post("/api/miniapp/bind")
    def bind_device() -> Any:
        try:
            body = _json_body()
            user = _verify_telegram_init_data(body.get("initData"))
            digest = _code_digest(str(body.get("activationCode", "")))
        except RuntimeError as error:
            return jsonify(error=str(error)), 503
        except ValueError as error:
            return jsonify(error=str(error)), 400

        connection = _get_database()
        now = _utc_timestamp()
        telegram_user_id = str(user["id"])
        try:
            connection.execute("BEGIN IMMEDIATE")
            existing_binding = connection.execute(
                "SELECT 1 FROM device_bindings WHERE telegram_user_id = ?",
                (telegram_user_id,),
            ).fetchone()
            if existing_binding:
                connection.rollback()
                return jsonify(error="该 Telegram 账号已绑定设备。"), 409
            code = connection.execute(
                """
                SELECT id, expires_at, used_at, revoked_at
                FROM activation_codes WHERE code_hash = ?
                """,
                (digest,),
            ).fetchone()
            if not code or code["revoked_at"] or code["used_at"] or code["expires_at"] <= now:
                connection.rollback()
                return jsonify(error="激活码无效、已使用或已过期。"), 400
            connection.execute(
                "UPDATE activation_codes SET used_at = ?, used_by = ? WHERE id = ?",
                (now, telegram_user_id, code["id"]),
            )
            connection.execute(
                """
                INSERT INTO device_bindings (telegram_user_id, activation_code_id, bound_at)
                VALUES (?, ?, ?)
                """,
                (telegram_user_id, code["id"], now),
            )
            connection.commit()
        except sqlite3.Error:
            connection.rollback()
            current_app.logger.exception("Failed to bind Telegram device")
            return jsonify(error="设备绑定暂时失败，请稍后重试。"), 500
        return jsonify(deviceBound=True)

    @app.get("/api/admin/session")
    def admin_session() -> Any:
        if not session.get("admin_authenticated"):
            return jsonify(authenticated=False)
        return jsonify(
            authenticated=True,
            csrfToken=session.get("csrf_token", ""),
            telegramConfigured=bool(app.config.get("TELEGRAM_BOT_TOKEN")),
        )

    @app.post("/api/admin/login")
    def admin_login() -> Any:
        try:
            body = _json_body()
        except ValueError as error:
            return jsonify(error=str(error)), 400
        supplied_password = body.get("password")
        if not isinstance(supplied_password, str):
            supplied_password = ""
        connection = _get_database()
        now = _utc_timestamp()
        remote_address = request.remote_addr or "unknown"
        attempt = connection.execute(
            "SELECT attempts, window_started_at, locked_until FROM login_attempts WHERE remote_address = ?",
            (remote_address,),
        ).fetchone()
        if attempt and attempt["locked_until"] > now:
            return jsonify(error="登录尝试过多，请 15 分钟后重试。"), 429
        if not hmac.compare_digest(supplied_password, app.config["ADMIN_PASSWORD"]):
            if attempt and now - attempt["window_started_at"] < LOGIN_WINDOW_SECONDS:
                attempts = attempt["attempts"] + 1
                window_started = attempt["window_started_at"]
            else:
                attempts = 1
                window_started = now
            locked_until = now + LOGIN_WINDOW_SECONDS if attempts >= MAX_LOGIN_ATTEMPTS else 0
            connection.execute(
                """
                INSERT INTO login_attempts (remote_address, attempts, window_started_at, locked_until)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(remote_address) DO UPDATE SET
                    attempts = excluded.attempts,
                    window_started_at = excluded.window_started_at,
                    locked_until = excluded.locked_until
                """,
                (remote_address, attempts, window_started, locked_until),
            )
            connection.commit()
            return jsonify(error="管理员密码不正确。"), 401
        connection.execute("DELETE FROM login_attempts WHERE remote_address = ?", (remote_address,))
        connection.commit()
        session.clear()
        session.permanent = True
        session["admin_authenticated"] = True
        session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify(
            authenticated=True,
            csrfToken=session["csrf_token"],
            telegramConfigured=bool(app.config.get("TELEGRAM_BOT_TOKEN")),
        )

    @app.post("/api/admin/logout")
    @_admin_required
    def admin_logout() -> Any:
        session.clear()
        return jsonify(authenticated=False)

    @app.get("/api/admin/config")
    @_admin_required
    def admin_get_config() -> Any:
        rows = _get_database().execute(
            "SELECT key, value FROM app_config WHERE key IN (?, ?)",
            ("publicGroupUrl", "announcementMessages"),
        ).fetchall()
        config = {row["key"]: json.loads(row["value"]) for row in rows}
        return jsonify(
            publicGroupUrl=config.get("publicGroupUrl", ""),
            announcementMessages=config.get("announcementMessages", []),
        )

    @app.put("/api/admin/config")
    @_admin_required
    def admin_save_config() -> Any:
        try:
            body = _json_body()
            group_url = _valid_group_url(body.get("publicGroupUrl", ""))
            messages = _validate_announcements(body.get("announcementMessages", []))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        connection = _get_database()
        connection.executemany(
            "INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [
                ("publicGroupUrl", json.dumps(group_url, ensure_ascii=False)),
                ("announcementMessages", json.dumps(messages, ensure_ascii=False)),
            ],
        )
        connection.commit()
        return jsonify(publicGroupUrl=group_url, announcementMessages=messages)

    @app.get("/api/admin/codes")
    @_admin_required
    def admin_list_codes() -> Any:
        now = _utc_timestamp()
        rows = _get_database().execute(
            """
            SELECT id, code_hint, created_at, expires_at, used_at, revoked_at
            FROM activation_codes ORDER BY created_at DESC LIMIT 200
            """
        ).fetchall()
        codes = []
        for row in rows:
            status = "revoked" if row["revoked_at"] else "used" if row["used_at"] else "expired" if row["expires_at"] <= now else "active"
            codes.append(
                {
                    "id": row["id"],
                    "hint": row["code_hint"],
                    "status": status,
                    "createdAt": _format_timestamp(row["created_at"]),
                    "expiresAt": _format_timestamp(row["expires_at"]),
                    "usedAt": _format_timestamp(row["used_at"]),
                }
            )
        return jsonify(codes=codes)

    @app.post("/api/admin/codes")
    @_admin_required
    def admin_create_codes() -> Any:
        try:
            body = _json_body()
            quantity = body.get("quantity", 1)
            expires_in_days = body.get("expiresInDays", 30)
            if type(quantity) is not int or not 1 <= quantity <= 25:
                raise ValueError("每次可生成 1 到 25 个激活码。")
            if type(expires_in_days) is not int or not 1 <= expires_in_days <= 365:
                raise ValueError("有效期必须为 1 到 365 天。")
        except ValueError as error:
            return jsonify(error=str(error)), 400

        connection = _get_database()
        now = _utc_timestamp()
        expires_at = now + expires_in_days * 24 * 60 * 60
        generated_codes = []
        for _ in range(quantity):
            code = _activation_code()
            normalized = code.replace("-", "")
            generated_codes.append(
                (
                    code,
                    str(uuid.uuid4()),
                    hashlib.sha256(normalized.encode("ascii")).hexdigest(),
                    f"…{normalized[-4:]}",
                )
            )
        connection.executemany(
            """
            INSERT INTO activation_codes (id, code_hash, code_hint, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (code_id, digest, hint, now, expires_at)
                for _, code_id, digest, hint in generated_codes
            ],
        )
        connection.commit()
        return jsonify(
            codes=[code for code, _, _, _ in generated_codes],
            expiresAt=_format_timestamp(expires_at),
        ), 201

    @app.delete("/api/admin/codes/<code_id>")
    @_admin_required
    def admin_revoke_code(code_id: str) -> Any:
        connection = _get_database()
        cursor = connection.execute(
            """
            UPDATE activation_codes SET revoked_at = ?
            WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL
            """,
            (_utc_timestamp(), code_id),
        )
        connection.commit()
        if cursor.rowcount == 0:
            return jsonify(error="激活码不存在、已使用或已撤销。"), 404
        return jsonify(revoked=True)

    @app.get("/api/admin/bindings")
    @_admin_required
    def admin_list_bindings() -> Any:
        rows = _get_database().execute(
            """
            SELECT telegram_user_id, bound_at
            FROM device_bindings ORDER BY bound_at DESC LIMIT 200
            """
        ).fetchall()
        return jsonify(
            bindings=[
                {
                    "telegramUserId": row["telegram_user_id"],
                    "boundAt": _format_timestamp(row["bound_at"]),
                }
                for row in rows
            ]
        )

    @app.delete("/api/admin/bindings/<telegram_user_id>")
    @_admin_required
    def admin_unbind_device(telegram_user_id: str) -> Any:
        if not re.fullmatch(r"\d{1,20}", telegram_user_id):
            return jsonify(error="Telegram 用户 ID 格式无效。"), 400
        cursor = _get_database().execute(
            "DELETE FROM device_bindings WHERE telegram_user_id = ?",
            (telegram_user_id,),
        )
        _get_database().commit()
        if cursor.rowcount == 0:
            return jsonify(error="未找到该 Telegram 账号的设备绑定。"), 404
        return jsonify(unbound=True)

    return app


if __name__ == "__main__":
    application = create_app()
    application.run(
        host=os.environ.get("MINIAPP_HOST", "127.0.0.1"),
        port=int(os.environ.get("MINIAPP_PORT", "8080")),
        debug=False,
    )
