def seg(speaker, text_, start, end, **extra):
    return {"speaker": speaker, "text": text_, "start_ms": start, "end_ms": end, **extra}
