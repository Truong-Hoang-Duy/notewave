import pytest
from sqlalchemy import inspect, text

from app import db
from app.db import engine, normalize_database_url
from tests.helpers import TEST_SCHEMA, qualified


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("postgres://u:p@h:5432/d", "postgresql+psycopg://u:p@h:5432/d"),
        ("postgresql://u:p@h:6543/postgres?sslmode=require", "postgresql+psycopg://u:p@h:6543/postgres?sslmode=require"),
        ("postgresql+psycopg://u:p@h/d", "postgresql+psycopg://u:p@h/d"),
        ("  postgresql://u:p@h/d  ", "postgresql+psycopg://u:p@h/d"),
    ],
)
def test_normalize_database_url(raw, expected):
    assert normalize_database_url(raw) == expected


@pytest.mark.parametrize("bad", ["", "sqlite:///./local.db", "mysql://u:p@h/d"])
def test_rejects_non_postgres_url(bad):
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        normalize_database_url(bad)


def test_connected_to_postgres_in_test_schema(client):
    assert engine.dialect.name == "postgresql"
    assert db.current_schema() == TEST_SCHEMA
    assert inspect(engine).has_table("note_sessions", schema=TEST_SCHEMA)


def test_column_types_are_postgres_native(client):
    columns = {c["name"]: c["type"].__class__.__name__ for c in inspect(engine).get_columns("note_sessions", schema=TEST_SCHEMA)}
    assert columns["segments"] == "JSONB"
    assert columns["summary"] == "JSONB"
    assert columns["merge_sources"] == "JSONB"
    with engine.connect() as conn:
        tz_types = dict(
            conn.execute(
                text(
                    "select column_name, data_type from information_schema.columns "
                    "where table_schema = :schema and table_name = 'note_sessions' "
                    "and column_name in ('created_at','updated_at','archived_at')"
                ),
                {"schema": TEST_SCHEMA},
            ).all()
        )
    assert set(tz_types.values()) == {"timestamp with time zone"}


def test_lower_handles_vietnamese(client):
    # Tìm kiếm dựa vào lower() của Postgres: phải xử lý đúng chữ có dấu (khác SQLite chỉ xử lý ASCII).
    with engine.connect() as conn:
        assert conn.execute(text("select lower('BÁO CÁO ĐỀ ÁN Ữ')")).scalar() == "báo cáo đề án ữ"


def test_add_missing_columns_restores_dropped_column(client):
    with engine.begin() as conn:
        conn.execute(text(f'ALTER TABLE {qualified("note_sessions")} DROP COLUMN "summary_outdated"'))
    db._add_missing_columns()
    names = {c["name"] for c in inspect(engine).get_columns("note_sessions", schema=TEST_SCHEMA)}
    assert "summary_outdated" in names
    db._add_missing_columns()  # chạy lại không lỗi


def test_row_level_security_blocks_supabase_api_roles(client, make_session):
    make_session("Bí mật")
    with engine.connect() as conn:
        rls = dict(
            conn.execute(
                text(
                    "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace "
                    "where n.nspname = :schema and c.relname in ('note_sessions','session_groups')"
                ),
                {"schema": TEST_SCHEMA},
            ).all()
        )
    assert rls == {"note_sessions": True, "session_groups": True}

    # Role `anon` của Supabase (dùng bởi Data API) không đọc được dữ liệu: hoặc bị từ chối quyền, hoặc RLS trả 0 dòng.
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            conn.execute(text("SET LOCAL ROLE anon"))
            visible = conn.execute(text(f"select count(*) from {qualified('note_sessions')}")).scalar()
        except Exception:
            visible = 0
        finally:
            trans.rollback()
    assert visible == 0

    # Backend (role postgres, chủ bảng) vẫn thấy dữ liệu
    assert client.get("/api/sessions").json()["total"] == 1
