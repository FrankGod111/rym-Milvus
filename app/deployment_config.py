from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DeploymentConfig:
    # Public service addresses used when deploying to another server.
    # For Windows/Docker deployment, update these values in code before packaging.
    backend_host: str = "0.0.0.0"
    backend_port: int = 8013
    backend_public_base_url: str = "http://127.0.0.1:8013"

    # Local LLM service. If Ollama runs on the same Windows server, keep 127.0.0.1.
    # If Ollama runs inside Docker, change this to the Docker service name or host IP.
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3:8b"

    # Dify service. For Docker Compose on Windows, this is often something like
    # http://host.docker.internal:5001 or http://dify-api:5001 depending on networking.
    dify_base_url: str = "http://127.0.0.1:5001"
    dify_dataset_id: str = ""
    dify_api_key: str = ""
    dify_app_api_key: str = ""

    # Frontend dev service address for documentation/reference.
    frontend_host: str = "0.0.0.0"
    frontend_port: int = 5185


DEPLOYMENT_CONFIG = DeploymentConfig()
