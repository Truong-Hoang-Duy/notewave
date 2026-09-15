"""Mistral OCR giả lập bằng httpx.MockTransport — test không bao giờ gọi API thật."""

import json
import re

import httpx
import pytest

from app.config import get_settings
from app.dependencies import get_ocr
from app.main import app
from app.services.ocr import OcrService

_FILENAME = re.compile(rb'filename="([^"]*)"')


class FakeMistral:
    def __init__(self):
        self.calls: list[str] = []
        self.fail_ocr = False
        self.fail_files: set[str] = set()  # tên file mà OCR sẽ lỗi
        self.pages_by_filename: dict[str, list[str]] = {}  # nội dung riêng theo tên file (mặc định: self.pages)
        self.uploaded_filenames: list[str] = []
        self.ocr_bodies: list[dict] = []
        self.last_ocr_body: dict | None = None
        self._files: dict[str, str] = {}  # file id -> tên file
        self.pages = [
            "# Biên bản họp\n\nChốt **deadline** cho bản demo, nhờ Lan viết meetting note.\n\n![img-0.jpeg](img-0.jpeg)",
            "| Việc | Người |\n|---|---|\n| Cài Kubernetis | Minh |\n\nGửi meetting note cho cả nhóm.",
        ]

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append(f"{method} {path}")
        assert request.headers["authorization"] == "Bearer test-mistral-key"
        if path == "/v1/files" and method == "POST":
            match = _FILENAME.search(request.read())
            filename = match.group(1).decode("utf-8", "replace") if match else "doc"
            file_id = f"mf-{len(self._files) + 1}"
            self._files[file_id] = filename
            self.uploaded_filenames.append(filename)
            return httpx.Response(
                200,
                json={
                    "id": file_id,
                    "object": "file",
                    "size_bytes": 10,
                    "created_at": 1_757_000_000,
                    "filename": filename,
                    "purpose": "ocr",
                    "sample_type": "ocr_input",
                    "source": "upload",
                },
            )
        if (m := re.fullmatch(r"/v1/files/(mf-\d+)/url", path)) and method == "GET":
            return httpx.Response(200, json={"url": f"https://files.mistral.example/signed/{m.group(1)}"})
        if path == "/v1/ocr" and method == "POST":
            body = json.loads(request.content)
            self.last_ocr_body = body
            self.ocr_bodies.append(body)
            url = body["document"].get("document_url") or body["document"].get("image_url")
            filename = self._files.get(url.rsplit("/", 1)[-1], "")
            if self.fail_ocr or filename in self.fail_files:
                return httpx.Response(400, json={"message": "bad document"})
            pages = self.pages_by_filename.get(filename, self.pages)
            return httpx.Response(
                200,
                json={
                    "model": "mistral-ocr-latest",
                    "pages": [
                        {"index": i, "markdown": md, "images": [], "dimensions": {"dpi": 200, "height": 100, "width": 100}}
                        for i, md in enumerate(pages)
                    ],
                    "usage_info": {"pages_processed": len(pages), "doc_size_bytes": 10},
                },
            )
        if (m := re.fullmatch(r"/v1/files/(mf-\d+)", path)) and method == "DELETE":
            return httpx.Response(200, json={"id": m.group(1), "object": "file", "deleted": True})
        return httpx.Response(404, json={"message": "not found"})


@pytest.fixture
def mistral():
    fake = FakeMistral()
    http = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_ocr] = lambda: OcrService(get_settings(), http)
    yield fake
    app.dependency_overrides.pop(get_ocr, None)
