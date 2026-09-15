from datetime import datetime, timezone

from sqlalchemy import Column, DateTime


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def tz_column(*, nullable: bool = False, index: bool = False) -> Column:
    """Cột `timestamptz` của Postgres (mặc định SQLModel tạo `timestamp without time zone`)."""
    return Column(DateTime(timezone=True), nullable=nullable, index=index)


def aware(dt: datetime | None) -> datetime | None:
    # Cột timestamptz luôn trả về datetime có múi giờ; giữ hàm để phòng dữ liệu cũ không có tz.
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
