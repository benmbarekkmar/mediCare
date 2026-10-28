"""Intent classifier: TF-IDF + logistic regression, or multilingual embeddings.

`USE_EMBEDDINGS=true` switches to sentence-transformers cosine similarity against
the same example bank; without that optional dependency the scikit-learn path is
used. No LLM API is involved in either branch.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from .config import DATA_DIR, settings
from .normalize import normalize


class TrainingDataMissing(RuntimeError):
    pass


def read_examples(path: Path) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    if not path.exists():
        raise TrainingDataMissing(f"Missing example bank: {path}. Run scripts/generate_intents.py first.")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        examples.append(json.loads(line))
    return examples


class IntentClassifier:
    """Fits on `data/intents.jsonl` at startup, ~300 examples train in milliseconds."""

    def __init__(self) -> None:
        self.backend = "sklearn-tfidf-logreg"
        self.model: Any = None
        self.embedder: Any = None
        self.examples: list[dict[str, Any]] = []
        self.labels: list[str] = []
        self._vectors: Any = None

    def train(self, path: Path | None = None) -> dict[str, Any]:
        self.examples = read_examples(path or (DATA_DIR / "intents.jsonl"))
        texts = [example["text"] for example in self.examples]
        labels = [example["intent"] for example in self.examples]
        self.labels = sorted(set(labels))
        if settings.use_embeddings:
            try:
                self._train_embeddings(texts, labels)
            except Exception:
                self._train_sklearn(texts, labels)
        else:
            self._train_sklearn(texts, labels)
        return {"backend": self.backend, "examples": len(texts), "intents": len(self.labels)}

    def _train_sklearn(self, texts: list[str], labels: list[str]) -> None:
        self.backend = "sklearn-tfidf-logreg"
        model = Pipeline(
            [
                (
                    "tfidf",
                    TfidfVectorizer(
                        analyzer="char_wb",
                        ngram_range=(3, 5),
                        sublinear_tf=True,
                        min_df=1,
                        lowercase=False,
                    ),
                ),
                ("clf", LogisticRegression(max_iter=2000, C=8.0, class_weight="balanced")),
            ]
        )
        model.fit([normalize(t) for t in texts], labels)
        self.model, self.embedder, self._vectors = model, None, None

    def _train_embeddings(self, texts: list[str], labels: list[str]) -> None:
        from sentence_transformers import SentenceTransformer  # optional dependency

        self.backend = f"sentence-transformers:{settings.embedding_model}"
        self.embedder = SentenceTransformer(settings.embedding_model)
        self._vectors = self.embedder.encode([normalize(t) for t in texts], show_progress_bar=False)
        self._labels = list(labels)
        self.model = None

    def predict(self, text: str) -> tuple[str | None, float, dict[str, float]]:
        plain = normalize(text)
        if self.embedder is not None and self._vectors is not None:
            import numpy as np

            vector = self.embedder.encode([plain], show_progress_bar=False)
            norms = np.linalg.norm(self._vectors, axis=1) * np.linalg.norm(vector, axis=1)
            similarity = (self._vectors @ vector.T).ravel() / np.where(norms == 0, 1, norms)
            scores: dict[str, list[float]] = {}
            for label, value in zip(self._labels, similarity):
                scores.setdefault(label, []).append(float(value))
            averaged = {label: max(values) for label, values in scores.items()}
            best = max(averaged, key=averaged.get)
            return best, averaged[best], averaged
        if self.model is None:
            return None, 0.0, {}
        probabilities = self.model.predict_proba([plain])[0]
        scores = {str(label): float(p) for label, p in zip(self.model.classes_, probabilities)}
        best = max(scores, key=scores.get)
        return best, scores[best], scores

    def nearest_questions(self, text: str, count: int = 5) -> list[str]:
        """Suggestion list for a question the pipeline could not understand."""
        from rapidfuzz import fuzz, process

        choices = [example["text"] for example in self.examples]
        if not choices:
            return []
        hits = process.extract(normalize(text), choices, scorer=fuzz.WRatio, limit=count, score_cutoff=0)
        picked: list[str] = []
        for _surface, _score, index in hits:
            question = choices[index]
            if question not in picked:
                picked.append(question)
            if len(picked) >= count:
                break
        return picked

    def distribution(self) -> dict[str, int]:
        return dict(Counter(example["intent"] for example in self.examples))
