"""FastAPI surface of the MedicCare NLP service.

The back-end is the only intended caller: it re-validates and executes the
generated SPARQL. Nothing here touches the store except through the read-only
vocabulary query, and no LLM API is used anywhere in the pipeline.
"""

from __future__ import annotations

from typing import Any

from fastapi import Body, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .classifier import TrainingDataMissing
from .config import SPACY_MODELS, settings
from .evaluation import evaluate as run_evaluation
from .fuseki import FusekiError, ping
from .intents import INTENTS
from .pipeline import NlpPipeline

app = FastAPI(
    title="MedicCare NLP service",
    version="1.0.0",
    description="French/English natural language to SPARQL over the MedicCare medical-care ontology, without any LLM API.",
)
pipeline = NlpPipeline()


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=400)
    locale: str | None = None
    limit: int | None = Field(default=None, ge=1, le=500)
    # injected by the back-end from the access token, never from the question text
    own_patient: str | None = Field(default=None, pattern=r"^Patient_[A-Za-z0-9_]+$")


class TranslateRequest(BaseModel):
    question: str = Field(min_length=2, max_length=400)
    language: str | None = None


@app.post("/ask")
def ask(request: AskRequest) -> dict[str, Any]:
    return _run(lambda: pipeline.ask(request.question, request.locale, request.limit, request.own_patient))


@app.post("/parse")
def parse(request: AskRequest) -> dict[str, Any]:
    return _run(lambda: pipeline.parse(request.question, request.locale))


@app.post("/translate")
def translate(request: TranslateRequest) -> dict[str, Any]:
    """Kept for the console: same contract as /ask, the locale is explicit."""
    return _run(lambda: pipeline.ask(request.question, request.language))


@app.get("/health")
def health() -> dict[str, Any]:
    store = ping()
    return {
        "ok": bool(pipeline.status["ready"]) and store["ok"],
        "version": "1.0.0",
        "language": "en+fr",
        "models": [{"name": name, "loaded": True} for name in SPACY_MODELS.values()],
        "vocabSize": pipeline.status.get("vocabulary", {}).get("terms", 0),
        "intents": [intent.name for intent in INTENTS],
        "store": store,
        "classifier": {
            "backend": pipeline.classifier.backend,
            "examples": len(pipeline.classifier.examples),
        },
        "minConfidence": settings.min_confidence,
    }


@app.get("/vocabulary")
def vocabulary() -> dict[str, Any]:
    return _run(pipeline.vocabulary)


@app.get("/intents")
def intents() -> dict[str, Any]:
    return {
        "intents": [
            {
                "name": intent.name,
                "roles": list(intent.roles),
                "needs": intent.needs,
                "explanation": intent.explanation,
            }
            for intent in INTENTS
        ]
    }


@app.post("/evaluate")
def evaluate(payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Re-runs the bundled evaluation cases, or the cases passed in the body."""
    cases = payload.get("cases")
    return _run(lambda: run_evaluation(cases, pipeline))


@app.get("/evaluation")
def evaluation_get() -> dict[str, Any]:
    return _run(lambda: run_evaluation(None, pipeline))


@app.post("/reload")
def reload_() -> dict[str, Any]:
    """Rebuilds the vocabulary from Fuseki and refits the classifier."""
    return _run(pipeline.reload)


def _run(action: Any) -> Any:
    try:
        pipeline.ensure_ready()
        return action()
    except FusekiError as err:
        raise HTTPException(status_code=503, detail=f"The Fuseki store is unreachable: {err}") from err
    except TrainingDataMissing as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.on_event("startup")
def startup() -> None:
    try:
        pipeline.reload()
    except Exception as err:  # a cold store only degrades the vocabulary, /health reports it
        pipeline.status = {"ready": True, "store_error": str(err), "vocabulary": {}, "training": {}}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(__import__("os").environ.get("NLP_PORT", "8100")))
