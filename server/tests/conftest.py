"""Test suite chạy trên Postgres thật (Supabase local), KHÔNG dùng SQLite.

Chuẩn bị: `npx supabase start` ở gốc repo. Mặc định dùng database riêng `notewave_test`
trên Postgres local (tự tạo nếu chưa có) để không đụng dữ liệu dev trong database `postgres`.
Đổi bằng biến môi trường TEST_DATABASE_URL nếu cần.
"""

import os

import psycopg
import pytest
from psycopg import sql
from sqlalchemy.engine import make_url

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/notewave_test"
)
_url = make_url(TEST_DATABASE_URL)
if "test" not in (_url.database or ""):
    raise RuntimeError(
        f"TEST_DATABASE_URL phải trỏ tới database có chữ 'test' (hiện: {_url.database!r}) — "
        "test suite TRUNCATE toàn bộ bảng sau mỗi test."
    )


def _ensure_test_database() -> None:
    admin_url = _url.set(drivername="postgresql", database="postgres").render_as_string(hide_password=False)
    try:
        with psycopg.connect(admin_url, autocommit=True, connect_timeout=5) as conn:
            exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (_url.database,)).fetchone()
            if not exists:
                conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(_url.database)))
    except psycopg.OperationalError as exc:
        raise RuntimeError(
            "Không kết nối được Postgres local. Hãy chạy `npx supabase start` ở gốc repo trước khi chạy test."
        ) from exc


_ensure_test_database()

# Phải đặt biến môi trường TRƯỚC khi import app (engine + settings được tạo lúc import).
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SONIOX_API_KEY"] = "test-soniox-key"
os.environ["PUBLIC_BASE_URL"] = "https://api.example.com"
os.environ["SONIOX_WEBHOOK_SECRET"] = "s3cret"
os.environ["OPENAI_API_KEY"] = "test-openai-key"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402

from tests.soniox_fake import soniox  # noqa: E402, F401  (fixture Soniox giả lập)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:  # chạy lifespan -> init_db tạo bảng
        yield c


@pytest.fixture(autouse=True)
def clean_tables(client):
    yield
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE note_sessions, session_groups"))
    app.dependency_overrides.clear()


@pytest.fixture
def make_session(client):
    def _make(title="Phiên thử", source="live", segments=None, duration_ms=None):
        res = client.post(
            "/api/sessions",
            json={"title": title, "source": source, "segments": segments or [], "duration_ms": duration_ms},
        )
        assert res.status_code == 201, res.text
        return res.json()

    return _make
