"""The full translation pipeline: question -> language -> entities -> slots -> SPARQL."""

from __future__ import annotations

import threading
from typing import Any

from .classifier import IntentClassifier
from .config import settings
from .entities import Entity, Recognizer, extract_values
from .explain import explain
from .intents import INTENTS, Intent, SlotFiller, rule_candidates
from .lexicon import Lexicon
from .normalize import content_tokens, detect_language, normalize
from .sparql_builder import PREFIX_BLOCK, TemplateError, build

NOT_UNDERSTOOD = "not_understood"


class NlpPipeline:
    """One instance lives in the FastAPI app; reloading swaps the vocabulary atomically."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.lexicon = Lexicon()
        self.recognizer: Recognizer | None = None
        self.classifier = IntentClassifier()
        self.filler: SlotFiller | None = None
        self.status: dict[str, Any] = {"ready": False, "store_error": "", "training": {}}

    def reload(self) -> dict[str, Any]:
        with self.lock:
            self.lexicon = Lexicon()
            self.lexicon.build()
            self.recognizer = Recognizer(self.lexicon)
            self.filler = SlotFiller(self.lexicon)
            training = self.classifier.train()
            self.status = {
                "ready": True,
                "store_error": self.lexicon.store_error,
                "vocabulary": self.lexicon.stats(),
                "training": training,
            }
        return self.status

    def ensure_ready(self) -> None:
        if not self.status["ready"]:
            self.reload()

    # --- steps -------------------------------------------------------------------------------

    def step_language(self, question: str, locale: str | None) -> str:
        return detect_language(question, locale)

    def step_entities(self, question: str, lang: str) -> tuple[list[Entity], list[str], str, str]:
        assert self.recognizer is not None
        return self.recognizer.recognize(question, lang)

    def step_slots(
        self, entities: list[Entity], values: dict[str, Any], question: str, dep_keyword: str = ""
    ) -> dict[str, Any]:
        assert self.filler is not None
        return self.filler.fill(entities, values, question, dep_keyword)

    def step_intent(
        self, question: str, slots: dict[str, Any], canonical: str
    ) -> tuple[Intent | None, float, str, dict[str, float]]:
        """Rules first, the trained classifier as fallback and as confirmation."""
        candidates = rule_candidates(canonical, slots)
        predicted, probability, scores = self.classifier.predict(canonical)
        if candidates:
            rule_intent, confidence = candidates[0]
            if predicted == rule_intent.name:
                confidence = min(0.98, confidence + 0.05)
            return rule_intent, confidence, "rules+classifier" if predicted == rule_intent.name else "rules", scores
        if predicted and probability >= settings.min_confidence:
            intent = next((i for i in INTENTS if i.name == predicted), None)
            if intent is not None and all(_has(slots, need) for need in intent.needs):
                return intent, probability, "classifier", scores
        return None, probability, "none", scores

    # --- public API -------------------------------------------------------------------------

    def ask(
        self,
        question: str,
        locale: str | None = None,
        limit: int | None = None,
        own_patient: str | None = None,
    ) -> dict[str, Any]:
        self.ensure_ready()
        trace: list[dict[str, str]] = []
        lang = self.step_language(question, locale)
        trace.append(
            {
                "step": "language-detection",
                "tool": "langdetect",
                "detail": f"{lang} (forced locale: {locale or 'none'})",
            }
        )
        plain = normalize(question)
        trace.append(
            {
                "step": "normalization",
                "tool": "unicodedata + regex",
                "detail": f"lowercased, accents folded, {len(content_tokens(plain, lang))} content tokens",
            }
        )
        entities, lemmas, canonical, dep_keyword = self.step_entities(question, lang)
        trace.append(
            {
                "step": "tokenization-lemmatization",
                "tool": f"spaCy {_model(lang)}",
                "detail": f"{len(lemmas)} tokens, lemmas: {' '.join(lemmas[:12])}",
            }
        )
        trace.append(
            {
                "step": "entity-linking",
                "tool": "spaCy EntityRuler + RapidFuzz",
                "detail": ", ".join(f"{e.text}->{e.id} ({e.matched_via}, {e.score})" for e in entities) or "no ontology term found",
            }
        )
        if dep_keyword:
            trace.append(
                {
                    "step": "dependency-cues",
                    "tool": f"spaCy parser ({_model(lang)})",
                    "detail": f"search keyword {dep_keyword!r} taken from the verb object",
                }
            )
        values = extract_values(question)
        if limit:
            values["limit"] = limit
        trace.append({"step": "value-extraction", "tool": "regex slots", "detail": str(values) if values else "no numeric or date slot"})
        slots = self.step_slots(entities, values, question, dep_keyword)
        slots.pop("not_treatment", None)
        if own_patient and not slots.get("patient"):
            # a signed in patient says "my tests" without naming themselves: the IRI
            # comes from the session, so the question text never picks the record
            slots["patient"] = own_patient
            trace.append(
                {
                    "step": "own-data-injection",
                    "tool": "session identity supplied by the back-end",
                    "detail": f"patient slot set to {own_patient}",
                }
            )
        trace.append({"step": "slot-filling", "tool": "lexicon + rules", "detail": str({k: v for k, v in slots.items()})})

        intent, confidence, source, scores = self.step_intent(question, slots, canonical)
        trace.append(
            {
                "step": "intent-classification",
                "tool": f"rules + {self.classifier.backend}",
                "detail": f"{intent.name if intent else NOT_UNDERSTOOD} ({confidence:.2f}, source={source})",
            }
        )

        if intent is None or confidence < settings.min_confidence:
            suggestions = self.classifier.nearest_questions(canonical, 5)
            return {
                "question": question,
                "language": lang,
                "intent": NOT_UNDERSTOOD,
                "confidence": round(confidence, 3),
                "entities": [e.to_json() for e in entities],
                "slots": _public_slots(slots),
                "filters": _public_slots(slots),
                "sparql": "",
                "explanation": {
                    "en": "The question could not be mapped to a known intent. Try one of the suggestions.",
                    "fr": "La question ne correspond a aucune intention connue. Essayez une suggestion.",
                    "chosen": "The question could not be mapped to a known intent. Try one of the suggestions."
                    if lang != "fr"
                    else "La question ne correspond a aucune intention connue. Essayez une suggestion.",
                },
                "suggestions": suggestions,
                "pipeline": trace,
                "classifier_scores": {k: round(v, 3) for k, v in sorted(scores.items(), key=lambda kv: -kv[1])[:5]},
            }

        try:
            query = build(intent.name, slots)
        except TemplateError as err:
            trace.append({"step": "sparql-generation", "tool": "template library", "detail": f"refused: {err}"})
            return {
                "question": question,
                "language": lang,
                "intent": NOT_UNDERSTOOD,
                "confidence": round(confidence, 3),
                "entities": [e.to_json() for e in entities],
                "slots": _public_slots(slots),
                "filters": _public_slots(slots),
                "sparql": "",
                "explanation": {
                    "en": f"The intent was understood but a required term is missing ({err}).",
                    "fr": f"Intention comprise mais un terme obligatoire manque ({err}).",
                    "chosen": f"Intention comprise mais un terme obligatoire manque ({err})."
                    if lang == "fr"
                    else f"The intent was understood but a required term is missing ({err}).",
                },
                "suggestions": self.classifier.nearest_questions(question, 5),
                "pipeline": trace,
                "classifier_scores": {k: round(v, 3) for k, v in sorted(scores.items(), key=lambda kv: -kv[1])[:5]},
            }

        trace.append(
            {
                "step": "sparql-generation",
                "tool": "template library with escaped literals",
                "detail": f"{len(query.splitlines())} lines, prefixes included, LIMIT enforced",
            }
        )
        return {
            "question": question,
            "language": lang,
            "intent": intent.name,
            "confidence": round(confidence, 3),
            "entities": [e.to_json() for e in entities],
            "slots": _public_slots(slots),
            "filters": _public_slots(slots),
            "sparql": query,
            "explanation": explain(intent.name, slots, lang, self.lexicon),
            "suggestions": _related_questions(intent.name, self.classifier, question),
            "pipeline": trace,
            "allowed_roles": list(intent.roles),
            "classifier_scores": {k: round(v, 3) for k, v in sorted(scores.items(), key=lambda kv: -kv[1])[:5]},
        }

    def parse(self, question: str, locale: str | None = None) -> dict[str, Any]:
        return self.ask(question, locale)

    def vocabulary(self) -> dict[str, Any]:
        self.ensure_ready()
        return {
            "stats": self.lexicon.stats(),
            "store_error": self.lexicon.store_error,
            "classes": sorted({t.local for t in self.lexicon.terms if t.kind == "class"}),
            "properties": sorted({t.local for t in self.lexicon.terms if t.kind == "property"}),
            "individuals": sorted({t.local for t in self.lexicon.terms if t.kind == "individual"})[:200],
            "surfaces": sorted({t.surface for t in self.lexicon.terms})[:200],
            "intents": [intent.name for intent in INTENTS],
            "classifier": {
                "backend": self.classifier.backend,
                "examples": len(self.classifier.examples),
                "distribution": self.classifier.distribution(),
            },
            "prefix_block": PREFIX_BLOCK,
        }


def _has(slots: dict[str, Any], need: str) -> bool:
    return any(bool(slots.get(part)) for part in need.split("|"))


INTERNAL_SLOTS = {"individual", "not_treatment", "sub_class", "property"}


def _public_slots(slots: dict[str, Any]) -> dict[str, Any]:
    # class_* slots only disambiguate the rules, they are not user facing filters
    return {key: value for key, value in slots.items() if key not in INTERNAL_SLOTS and not key.startswith("class_")}


def _model(lang: str) -> str:
    from .config import SPACY_MODELS

    return SPACY_MODELS.get(lang, SPACY_MODELS["en"])


def _related_questions(intent: str, classifier: IntentClassifier, question: str, count: int = 4) -> list[str]:
    bank = [e["text"] for e in classifier.examples if e.get("intent") == intent and normalize(e["text"]) != normalize(question)]
    return bank[:count]
