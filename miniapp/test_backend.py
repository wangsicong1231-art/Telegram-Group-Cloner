from __future__ import annotations

import hashlib
import hmac
import json
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import urlencode

from backend import _activation_code, create_app


class AdminBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database = Path(self.temporary_directory.name) / "admin.sqlite3"
        self.app = create_app(
            {
                "TESTING": True,
                "SECRET_KEY": "test-session-secret-key-that-is-long-enough",
                "ADMIN_PASSWORD": "test-admin-password-long-enough",
                "TELEGRAM_BOT_TOKEN": "12345:test-bot-token",
                "DATABASE": str(database),
                "SESSION_COOKIE_SECURE": False,
            }
        )
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def login(self) -> str:
        response = self.client.post(
            "/api/admin/login",
            json={"password": "test-admin-password-long-enough"},
        )
        self.assertEqual(response.status_code, 200)
        return response.get_json()["csrfToken"]

    def signed_init_data(self, user_id: int = 123456) -> str:
        values = {
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": user_id, "first_name": "Test"}, separators=(",", ":")),
        }
        data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
        secret_key = hmac.new(
            b"WebAppData",
            b"12345:test-bot-token",
            hashlib.sha256,
        ).digest()
        values["hash"] = hmac.new(
            secret_key,
            data_check_string.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return urlencode(values)

    def test_admin_config_requires_session_and_csrf(self) -> None:
        self.assertEqual(self.client.get("/api/admin/config").status_code, 401)
        csrf = self.login()
        self.assertEqual(
            self.client.put(
                "/api/admin/config",
                json={"publicGroupUrl": "https://t.me/example", "announcementMessages": []},
            ).status_code,
            403,
        )
        response = self.client.put(
            "/api/admin/config",
            json={
                "publicGroupUrl": "https://t.me/example",
                "announcementMessages": ["设备状态更新", "欢迎使用"],
            },
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 200)
        public_config = self.client.get("/api/miniapp/config").get_json()
        self.assertEqual(public_config["publicGroupUrl"], "https://t.me/example")
        self.assertEqual(public_config["announcementMessages"], ["设备状态更新", "欢迎使用"])

    def test_invalid_group_link_is_rejected(self) -> None:
        csrf = self.login()
        response = self.client.put(
            "/api/admin/config",
            json={"publicGroupUrl": "https://example.com/invite", "announcementMessages": []},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 400)

    def test_generated_codes_are_one_time_and_bind_verified_telegram_user(self) -> None:
        csrf = self.login()
        generated = self.client.post(
            "/api/admin/codes",
            json={"quantity": 1, "expiresInDays": 10},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(generated.status_code, 201)
        code = generated.get_json()["codes"][0]
        self.assertEqual(len(code.replace("-", "")), 32)
        self.assertNotIn(code, str(self.client.get("/api/admin/codes").get_json()))

        binding = self.client.post(
            "/api/miniapp/bind",
            json={"initData": self.signed_init_data(), "activationCode": code.lower()},
        )
        self.assertEqual(binding.status_code, 200)
        self.assertTrue(binding.get_json()["deviceBound"])
        state = self.client.post(
            "/api/miniapp/state",
            json={"initData": self.signed_init_data()},
        )
        self.assertTrue(state.get_json()["deviceBound"])

        second_user = self.client.post(
            "/api/miniapp/bind",
            json={"initData": self.signed_init_data(789012), "activationCode": code},
        )
        self.assertEqual(second_user.status_code, 400)
        self.assertEqual(len(self.client.get("/api/admin/bindings").get_json()["bindings"]), 1)

    def test_admin_can_revoke_unused_activation_code(self) -> None:
        csrf = self.login()
        generated = self.client.post(
            "/api/admin/codes",
            json={"quantity": 1, "expiresInDays": 10},
            headers={"X-CSRF-Token": csrf},
        ).get_json()
        code = generated["codes"][0]
        code_id = self.client.get("/api/admin/codes").get_json()["codes"][0]["id"]
        response = self.client.delete(
            f"/api/admin/codes/{code_id}",
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 200)
        binding = self.client.post(
            "/api/miniapp/bind",
            json={"initData": self.signed_init_data(), "activationCode": code},
        )
        self.assertEqual(binding.status_code, 400)

    def test_tampered_telegram_init_data_is_rejected(self) -> None:
        self.login()
        response = self.client.post(
            "/api/miniapp/state",
            json={"initData": self.signed_init_data().replace("Test", "Changed")},
        )
        self.assertEqual(response.status_code, 401)

    def test_admin_login_is_rate_limited(self) -> None:
        for _ in range(5):
            self.client.post("/api/admin/login", json={"password": "incorrect"})
        response = self.client.post(
            "/api/admin/login",
            json={"password": "test-admin-password-long-enough"},
        )
        self.assertEqual(response.status_code, 429)

    def test_private_backend_file_is_not_served(self) -> None:
        admin_page = self.client.get("/admin")
        self.assertEqual(admin_page.status_code, 200)
        admin_page.close()
        dashboard_page = self.client.get("/index.html")
        self.assertEqual(dashboard_page.status_code, 200)
        dashboard_page.close()
        admin_script = self.client.get("/assets/admin.js")
        self.assertEqual(admin_script.status_code, 200)
        admin_script.close()
        private_file = self.client.get("/backend.py")
        self.assertEqual(private_file.status_code, 404)
        private_file.close()

    def test_database_cannot_be_placed_in_public_web_root(self) -> None:
        with self.assertRaises(RuntimeError):
            create_app(
                {
                    "SECRET_KEY": "test-session-secret-key-that-is-long-enough",
                    "ADMIN_PASSWORD": "test-admin-password-long-enough",
                    "DATABASE": str(Path(__file__).resolve().parent / "unsafe.sqlite3"),
                }
            )


class ActivationCodeTests(unittest.TestCase):
    def test_codes_have_128_bits_of_entropy_and_expected_format(self) -> None:
        code = _activation_code()
        groups = code.split("-")
        self.assertEqual(len(groups), 8)
        self.assertTrue(all(len(group) == 4 for group in groups))
        self.assertTrue(all(character in "0123456789ABCDEF" for character in code.replace("-", "")))


if __name__ == "__main__":
    unittest.main()
