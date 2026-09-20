from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Protocol


class StorageAdapter(Protocol):
    def save(self, file_bytes: bytes, filename: str) -> str: ...

    def url(self, path: str) -> str: ...


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _safe_filename(filename: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._")
    return cleaned or "contract-file"


class LocalStorage:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or (_repo_root() / "data" / "contracts" / "files")
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, file_bytes: bytes, filename: str) -> str:
        safe_name = _safe_filename(filename)
        stored_name = f"{uuid.uuid4().hex}_{safe_name}"
        target = self.root / stored_name
        target.write_bytes(file_bytes)
        return str(target.relative_to(_repo_root()))

    def url(self, path: str) -> str:
        return f"/{path.lstrip('/')}"


class OSSStorage:
    def __init__(self) -> None:
        self.bucket_name = os.getenv("OSS_BUCKET", "")
        self.endpoint = os.getenv("OSS_ENDPOINT", "")
        self.access_key_id = os.getenv("OSS_KEY", "")
        self.access_key_secret = os.getenv("OSS_SECRET", "")
        self.base_dir = os.getenv("OSS_BASE_DIR", "contracts/files")
        self.public_base_url = os.getenv("OSS_PUBLIC_BASE_URL", "")
        if not all([self.bucket_name, self.endpoint, self.access_key_id, self.access_key_secret]):
            raise RuntimeError("OSS is not fully configured.")

    def _bucket(self):
        try:
            import oss2
        except ImportError as exc:
            raise RuntimeError("oss2 is not installed. Please install requirements first.") from exc
        auth = oss2.Auth(self.access_key_id, self.access_key_secret)
        return oss2.Bucket(auth, self.endpoint, self.bucket_name)

    def save(self, file_bytes: bytes, filename: str) -> str:
        safe_name = _safe_filename(filename)
        object_key = f"{self.base_dir.strip('/')}/{uuid.uuid4().hex}_{safe_name}"
        bucket = self._bucket()
        bucket.put_object(object_key, file_bytes)
        return object_key

    def url(self, path: str) -> str:
        if self.public_base_url:
            return f"{self.public_base_url.rstrip('/')}/{path.lstrip('/')}"
        endpoint_host = self.endpoint.replace("https://", "").replace("http://", "")
        return f"https://{self.bucket_name}.{endpoint_host}/{path.lstrip('/')}"


def get_storage() -> StorageAdapter:
    if all(os.getenv(key) for key in ["OSS_BUCKET", "OSS_ENDPOINT", "OSS_KEY", "OSS_SECRET"]):
        return OSSStorage()
    return LocalStorage()
