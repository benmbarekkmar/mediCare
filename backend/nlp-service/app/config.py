"""Environment driven settings for the MedicCare NLP service."""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

# the pipeline is multilingual: one model per supported language
SPACY_MODELS = {"en": "en_core_web_md", "fr": "fr_core_news_md"}


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip() or default


class Settings:
    """Every value here is overridable through the environment, nothing secret is stored."""

    def __init__(self) -> None:
        self.fuseki_url = _env("FUSEKI_BASE_URL", "http://localhost:3030").rstrip("/")
        self.fuseki_dataset = _env("FUSEKI_DATASET", "medicare")
        self.fuseki_user = _env("FUSEKI_USER", "admin")
        # same public development default the docker-compose file documents
        self.fuseki_password = _env("FUSEKI_ADMIN_PASSWORD") or _env("FUSEKI_PASSWORD", "medicare")
        self.timeout_s = int(_env("NLP_FUSEKI_TIMEOUT_S", "15"))
        self.use_embeddings = _env("USE_EMBEDDINGS", "false").lower() in {"1", "true", "yes"}
        self.embedding_model = _env("EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
        self.min_confidence = float(_env("NLP_MIN_CONFIDENCE", "0.45"))
        self.default_limit = int(_env("NLP_DEFAULT_LIMIT", "50"))
        self.max_limit = int(_env("NLP_MAX_LIMIT", "200"))

    @property
    def sparql_endpoint(self) -> str:
        return f"{self.fuseki_url}/{self.fuseki_dataset}/query"

    @property
    def auth(self) -> tuple[str, str]:
        return (self.fuseki_user, self.fuseki_password)


settings = Settings()
