import logging
from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings

logger = logging.getLogger(__name__)

DATABASE_URL_HINT = (
    "Local: chạy `npx supabase start` rồi dán giá trị DB URL "
    "(postgresql://postgres:postgres@127.0.0.1:54322/postgres) vào file .env. "
    "Production: lấy connection string (Transaction pooler) ở Supabase Dashboard."
)


def normalize_database_url(url: str) -> str:
    """Supabase/Render có thể cấp URL dạng postgres:// hoặc postgresql:// — ép dùng driver psycopg (v3)."""
    url = url.strip()
    if not url:
        raise RuntimeError(f"DATABASE_URL chưa được cấu hình. {DATABASE_URL_HINT}")
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    if not url.startswith("postgresql+psycopg://"):
        raise RuntimeError(f"DATABASE_URL phải là connection string Postgres (Supabase). {DATABASE_URL_HINT}")
    return url


def create_db_engine(url: str) -> Engine:
    normalized = normalize_database_url(url)
    return create_engine(
        normalized,
        # Kết nối qua Supabase pooler có thể bị đóng phía server khi rảnh -> kiểm tra trước khi dùng.
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=5,
        connect_args={
            # Transaction pooler (Supavisor, cổng 6543) không hỗ trợ prepared statement giữa các
            # transaction; tắt prepared statement của psycopg để chạy được cả pooler lẫn kết nối trực tiếp.
            "prepare_threshold": None,
            "application_name": "notewave-api",
        },
    )


engine = create_db_engine(get_settings().database_url)


def describe_database() -> str:
    """Chuỗi mô tả DB đang dùng (ẩn mật khẩu) để log khi khởi động."""
    return make_url(engine.url).render_as_string(hide_password=True)


def init_db() -> None:
    # Import để SQLModel đăng ký bảng trước khi create_all.
    from app.models import group as _group, session as _session  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    _enable_row_level_security()


def _enable_row_level_security() -> None:
    """Supabase tự expose schema `public` qua Data API (PostgREST) cho role anon/authenticated.
    Bật RLS (không tạo policy) để chặn mọi truy cập qua API đó; backend kết nối bằng role `postgres`
    — chủ sở hữu bảng — nên không bị ảnh hưởng. Lệnh idempotent, chạy mỗi lần khởi động."""
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            conn.execute(text(f"ALTER TABLE {table.name} ENABLE ROW LEVEL SECURITY"))


def _add_missing_columns() -> None:
    """Migration tối giản (chưa dùng Alembic): create_all không thêm cột mới vào bảng đã tồn tại,
    nên bổ sung các cột còn thiếu bằng ALTER TABLE ADD COLUMN (luôn nullable) kèm index tương ứng.
    Chỉ hỗ trợ THÊM cột; đổi kiểu/xoá cột vẫn phải migrate tay."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            added = []
            for column in table.columns:
                if column.name in existing:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{column.name}" {col_type}'))
                default = column.default.arg if column.default is not None and not callable(column.default.arg) else None
                if default is not None:
                    conn.execute(text(f'UPDATE {table.name} SET "{column.name}" = :v'), {"v": default})
                added.append(column.name)
            for index in table.indexes:
                if any(c.name in added for c in index.columns):
                    index.create(conn, checkfirst=True)
            if added:
                logger.info("Đã thêm cột %s vào bảng %s", ", ".join(added), table.name)


def get_db() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
