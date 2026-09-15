import pytest
from sqlalchemy import inspect, text

from app import db
from app.db import engine, normalize_database_url


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


def test_connected_to_postgres(client):
    assert engine.dialect.name == "postgresql"
    with engine.connect() as conn:
        assert conn.execute(text("select current_database()")).scalar().endswith("test")


def test_column_types_are_postgres_native(client):
    columns = {c["name"]: c["type"].__class__.__name__ for c in inspect(engine).get_columns("note_sessions")}
    assert columns["segments"] == "JSONB"
    assert columns["summary"] == "JSONB"
    assert columns["merge_sources"] == "JSONB"
    with engine.connect() as conn:
        tz_types = dict(
            conn.execute(
                text(
                    "select column_name, data_type from information_schema.columns "
                    "where table_name = 'note_sessions' and column_name in ('created_at','updated_at','archived_at')"
                )
            ).all()
        )
    assert set(tz_types.values()) == {"timestamp with time zone"}


def test_lower_handles_vietnamese(client):
    # Tìm kiếm dựa vào lower() của Postgres: phải xử lý đúng chữ có dấu (khác SQLite chỉ xử lý ASCII).
    with engine.connect() as conn:
        assert conn.execute(text("select lower('BÁO CÁO ĐỀ ÁN Ữ')")).scalar() == "báo cáo đề án ữ"


def test_add_missing_columns_restores_dropped_column(client):
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE note_sessions DROP COLUMN "summary_outdated"'))
    db._add_missing_columns()
    names = {c["name"] for c in inspect(engine).get_columns("note_sessions")}
    assert "summary_outdated" in names
    db._add_missing_columns()  # chạy lại không lỗi


def test_row_level_security_blocks_supabase_api_roles(client, make_session):
    make_session("Bí mật")
    with engine.connect() as conn:
        rls = dict(conn.execute(text("select relname, relrowsecurity from pg_class where relname in ('note_sessions','session_groups')")).all())
    assert rls == {"note_sessions": True, "session_groups": True}

    # Role `anon` của Supabase (dùng bởi Data API) không đọc được dữ liệu: hoặc bị từ chối quyền, hoặc RLS trả 0 dòng.
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            conn.execute(text("SET LOCAL ROLE anon"))
            visible = conn.execute(text("select count(*) from note_sessions")).scalar()
        except Exception:
            visible = 0
        finally:
            trans.rollback()
    assert visible == 0

    # Backend (role postgres, chủ bảng) vẫn thấy dữ liệu
    assert client.get("/api/sessions").json()["total"] == 1
