"""Embedding providers used by the vector data plane."""

from __future__ import annotations

import hashlib
import math
import os
from typing import Any

import httpx


class EmbeddingError(RuntimeError):
    pass


class EmbeddingProvider:
    dimension: int
    model: str

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError


class HashEmbeddingProvider(EmbeddingProvider):
    """Deterministic local fallback for development and smoke tests.

    It keeps the data-plane executable without downloading a model; production
    should use Ollama or another real embedding endpoint.
    """

    def __init__(self, dimension: int = 256) -> None:
        self.dimension = dimension
        self.model = "hash-dev-v1"

    def embed(self, texts: list[str]) -> list[list[float]]:
        output: list[list[float]] = []
        for text in texts:
            values = [0.0] * self.dimension
            tokens = text.lower().split()
            for token in tokens or [text.lower()]:
                digest = hashlib.sha256(token.encode("utf-8")).digest()
                index = int.from_bytes(digest[:4], "big") % self.dimension
                values[index] += 1.0 if digest[4] % 2 else -1.0
            norm = math.sqrt(sum(value * value for value in values)) or 1.0
            output.append([value / norm for value in values])
        return output


class OllamaEmbeddingProvider(EmbeddingProvider):
    def __init__(self, model: str, base_url: str = "http://127.0.0.1:11434") -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.dimension = int(os.environ.get("KNOWLEDGE_VECTOR_DIMENSION", "768"))

    def embed(self, texts: list[str]) -> list[list[float]]:
        result: list[list[float]] = []
        with httpx.Client(timeout=120, trust_env=False) as client:
            for text in texts:
                response = client.post(f"{self.base_url}/api/embeddings", json={"model": self.model, "prompt": text})
                if not response.is_success:
                    raise EmbeddingError(f"Ollama embedding failed: {response.status_code} {response.text[:300]}")
                vector = response.json().get("embedding")
                if not isinstance(vector, list) or not vector:
                    raise EmbeddingError("Ollama returned an empty embedding")
                self.dimension = len(vector)
                result.append([float(value) for value in vector])
        return result


def get_embedding_provider() -> EmbeddingProvider:
    provider = os.environ.get("KNOWLEDGE_EMBEDDING_PROVIDER", "hash").lower()
    if provider == "ollama":
        return OllamaEmbeddingProvider(
            model=os.environ.get("KNOWLEDGE_EMBEDDING_MODEL", "nomic-embed-text"),
            base_url=os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
        )
    return HashEmbeddingProvider(int(os.environ.get("KNOWLEDGE_VECTOR_DIMENSION", "256")))
