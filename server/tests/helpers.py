# Schema riêng cho test trên cùng DB Supabase với production — không bao giờ dùng `public`.
TEST_SCHEMA = "notewave_test"


def qualified(table_name: str) -> str:
    """Tên bảng kèm schema test, dùng cho SQL thô (text()) trong test."""
    return f'"{TEST_SCHEMA}".{table_name}'


def seg(speaker, text_, start, end, **extra):
    return {"speaker": speaker, "text": text_, "start_ms": start, "end_ms": end, **extra}
