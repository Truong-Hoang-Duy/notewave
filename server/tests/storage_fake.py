"""Supabase Storage giả lập bằng httpx.MockTransport — test không bao giờ gọi Storage thật."""

import json
import re
from urllib.parse import unquote

import httpx
import pytest

from app.config import get_settings
from app.dependencies import get_storage
from app.main import app
from app.services.storage import SupabaseStorage

BASE = "https://storage.example.supabase.co/storage/v1"


class FakeStorage:
    def __init__(self):
        self.calls: list[str] = []
        self.buckets: set[str] = set()  # chưa có bucket nào -> lần tải đầu phải tự tạo
        self.objects: dict[str, bytes] = {}  # "bucket/path" -> nội dung
        self.fail_upload = False
        self.fail_delete = False
        self.last_headers: httpx.Headers | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = unquote(request.url.path), request.method
        self.calls.append(f"{method} {path}")
        self.last_headers = request.headers
        assert request.headers["apikey"] == "sb_secret_test"
        assert "authorization" not in request.headers  # khoá sb_secret_ không gửi Bearer
        if path == "/storage/v1/bucket" and method == "POST":
            body = json.loads(request.content)
            assert body["public"] is False
            self.buckets.add(body["id"])
            return httpx.Response(200, json={"name": body["id"]})
        if (m := re.fullmatch(r"/storage/v1/object/sign/([^/]+)/(.+)", path)) and method == "POST":
            key = f"{m.group(1)}/{m.group(2)}"
            if key not in self.objects:
                return httpx.Response(400, json={"statusCode": "404", "error": "not_found", "message": "Object not found"})
            return httpx.Response(200, json={"signedURL": f"/object/sign/{key}?token=tok-{len(self.calls)}"})
        if (m := re.fullmatch(r"/storage/v1/object/([^/]+)/(.+)", path)) and method == "POST":
            bucket, obj = m.group(1), m.group(2)
            if bucket not in self.buckets:
                return httpx.Response(400, json={"statusCode": "404", "error": "Bucket not found", "message": "Bucket not found"})
            if self.fail_upload:
                return httpx.Response(500, json={"message": "boom"})
            self.objects[f"{bucket}/{obj}"] = request.content
            return httpx.Response(200, json={"Key": f"{bucket}/{obj}"})
        if (m := re.fullmatch(r"/storage/v1/object/([^/]+)", path)) and method == "DELETE":
            if self.fail_delete:
                return httpx.Response(500, json={"message": "boom"})
            prefixes = json.loads(request.content)["prefixes"]
            for p in prefixes:
                self.objects.pop(f"{m.group(1)}/{p}", None)
            return httpx.Response(200, json=[{"name": p} for p in prefixes])
        return httpx.Response(404, json={"message": "not found"})


@pytest.fixture
def storage():
    fake = FakeStorage()
    http = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_storage] = lambda: SupabaseStorage(http, get_settings())
    yield fake
    app.dependency_overrides.pop(get_storage, None)
