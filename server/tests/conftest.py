"""Test suite chạy trên Postgres thật của Supabase — cùng project (cùng DB) với production.

URL lấy từ `TEST_DATABASE_URL` nếu có, không thì dùng `DATABASE_URL` trong `.env`.
AN TOÀN DỮ LIỆU: test KHÔNG dùng schema `public` (dữ liệu thật). Mọi bảng test nằm trong schema riêng
`notewave_test` (tự tạo): engine được gắn `schema_translate_map` nên mọi câu lệnh SQLAlchemy sinh ra đều ghi
rõ tên schema (không phụ thuộc `search_path`, vốn không giữ được qua Transaction pooler). SQL thô trong test
phải dùng `qualified()` bên dưới. TRUNCATE sau mỗi test chỉ chạy trên schema test.
"""

import os

import pytest
from sqlalchemy import text

from app.config import Settings
from tests.helpers import TEST_SCHEMA, qualified
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or Settings().database_url
if not TEST_DATABASE_URL:
    raise RuntimeError("Chưa có DATABASE_URL (hoặc TEST_DATABASE_URL) để chạy test — điền connection string Supabase vào .env.")

# Phải đặt biến môi trường TRƯỚC khi import app (engine + settings được tạo lúc import).
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SONIOX_API_KEY"] = "test-soniox-key"
os.environ["PUBLIC_BASE_URL"] = "https://api.example.com"
os.environ["SONIOX_WEBHOOK_SECRET"] = "s3cret"
os.environ["MISTRAL_API_KEY"] = "test-mistral-key"
if os.environ.get("RUN_LLM_TESTS") != "1":
    # Mặc định không bao giờ gọi LLM thật; RUN_LLM_TESTS=1 thì dùng key thật trong .env.
    os.environ["OPENAI_API_KEY"] = "test-openai-key"

from app import db  # noqa: E402

with db.engine.begin() as _conn:
    _conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{TEST_SCHEMA}"'))
# Thay engine của app bằng engine trỏ vào schema test, trước khi app.main và các file test import `engine`.
db.engine = db.engine.execution_options(schema_translate_map={None: TEST_SCHEMA})
assert db.current_schema() == TEST_SCHEMA

from fastapi.testclient import TestClient  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402

from tests.soniox_fake import soniox  # noqa: E402, F401  (fixture Soniox giả lập)
from tests.mistral_fake import mistral  # noqa: E402, F401  (fixture Mistral OCR giả lập)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:  # chạy lifespan -> init_db tạo bảng
        yield c


@pytest.fixture(autouse=True)
def clean_tables(client):
    yield
    # Chặn cứng: không bao giờ TRUNCATE nếu engine không trỏ vào schema test.
    assert db.current_schema() == TEST_SCHEMA != "public"
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {qualified('note_sessions')}, {qualified('session_groups')}"))
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
