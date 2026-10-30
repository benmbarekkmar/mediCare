"""The full translation pipeline: question -> language -> entities -> slots -> SPARQL."""

from __future__ import annotations

import re
import threading
from typing import Any

from .classifier import IntentClassifier
from .config import settings
from .entities import Entity, Recognizer, extract_values
from .explain import explain
from .intents import INTENTS, Intent, SlotFiller, rule_candidates
from .lexicon import Lexicon
from .normalize import content_tokens, detect_language, normalize, to_model_language
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
        history: list[str] | None = None,
    ) -> dict[str, Any]:
        self.ensure_ready()
        trace: list[dict[str, str]] = []
        lang = self.step_language(question, locale)
        model_lang = _model_language(lang)
        analysis_question = to_model_language(question, lang)
        trace.append(
            {
                "step": "language-detection",
                "tool": "Unicode script + Derja lexical cues + langdetect",
                "detail": f"{lang} (forced locale: {locale or 'none'})",
            }
        )
        plain = normalize(analysis_question)
        trace.append(
            {
                "step": "normalization",
                "tool": "local multilingual lexicon + unicodedata + regex",
                "detail": f"mapped to {model_lang}, {len(content_tokens(plain, model_lang))} content tokens",
            }
        )
        entities, lemmas, canonical, dep_keyword = self.step_entities(analysis_question, model_lang)
        trace.append(
            {
                "step": "tokenization-lemmatization",
                "tool": f"spaCy {_model(model_lang)}",
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
                    "tool": f"spaCy parser ({_model(model_lang)})",
                    "detail": f"search keyword {dep_keyword!r} taken from the verb object",
                }
            )
        values = extract_values(analysis_question)
        if limit:
            values["limit"] = limit
        trace.append({"step": "value-extraction", "tool": "regex slots", "detail": str(values) if values else "no numeric or date slot"})
        slots = self.step_slots(entities, values, analysis_question, dep_keyword)
        slots.pop("not_treatment", None)

        # Follow-ups may omit a medical entity ("what about its symptoms?").
        # Only prior user questions are considered; result rows are never sent as context.
        if history and _is_follow_up(question):
            context_slots = ("patient", "doctor", "disease", "symptom", "treatment", "medication", "test", "department", "hospital", "appointment")
            recovered: dict[str, Any] = {}
            for previous in reversed(history[-6:]):
                prior_lang = detect_language(previous)
                prior_text = to_model_language(previous, prior_lang)
                prior_entities, _prior_lemmas, _prior_canonical, prior_dep = self.step_entities(
                    prior_text, _model_language(prior_lang)
                )
                prior_slots = self.step_slots(prior_entities, extract_values(prior_text), prior_text, prior_dep)
                for key in context_slots:
                    if not slots.get(key) and prior_slots.get(key):
                        slots[key] = prior_slots[key]
                        recovered[key] = prior_slots[key]
                if recovered:
                    break
            if recovered:
                trace.append({
                    "step": "conversation-context",
                    "tool": "recent user questions + spaCy entity linking",
                    "detail": f"recovered missing entity slots: {recovered}",
                })

        care_navigation = _is_general_doctor_recommendation(question)
        if care_navigation:
            # A symptom-based request for a clinician is a directory lookup, never a
            # lookup of the signed-in user's care team.
            slots.setdefault("specialty", "GeneralPractitioner")
            trace.append({
                "step": "care-navigation",
                "tool": "local phrasing rules + ontology specialty",
                "detail": "general practitioner selected as a first-contact directory category",
            })

        if own_patient and not slots.get("patient") and _asks_about_own_record(question):
            # Only an explicit request about the user's own record can use the session IRI.
            slots["patient"] = own_patient
            trace.append(
                {
                    "step": "own-data-injection",
                    "tool": "session identity supplied by the back-end",
                    "detail": f"patient slot set to {own_patient}",
                }
            )
        trace.append({"step": "slot-filling", "tool": "lexicon + rules", "detail": str({k: v for k, v in slots.items()})})

        if _is_emergency_signal(question):
            trace.append({
                "step": "medical-safety",
                "tool": "local emergency symptom rules",
                "detail": "urgent symptoms detected; no medical data query was generated",
            })
            return {
                "question": question,
                "language": lang,
                "intent": NOT_UNDERSTOOD,
                "confidence": 1.0,
                "entities": [e.to_json() for e in entities],
                "slots": _public_slots(slots),
                "filters": _public_slots(slots),
                "sparql": "",
                "explanation": _emergency_explanations(),
                "suggestions": [],
                "pipeline": trace,
                "allowed_roles": [],
                "classifier_scores": {},
                "safety": "emergency",
            }

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
                "tool": "safe SPARQL templates + RDFLib parseQuery validator",
                "detail": f"valid SPARQL syntax; {len(query.splitlines())} lines, prefixes included, LIMIT enforced",
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
            "safety": "care_navigation" if care_navigation else None,
            "classifier_scores": {k: round(v, 3) for k, v in sorted(scores.items(), key=lambda kv: -kv[1])[:5]},
        }

    def parse(
        self, question: str, locale: str | None = None, history: list[str] | None = None
    ) -> dict[str, Any]:
        return self.ask(question, locale, history=history)

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


OWN_RECORD_PATTERNS = (
    r"\b(?:my|mine|our)\s+(?:medical\s+)?(?:record|records|(?:(?:blood|urine|medical)\s+)?tests?|test results?|appointments?|doctor|diseases?|conditions?|medications?|results?|care team)\b",
    r"\b(?:mon|ma|mes)\s+(?:dossier|dossiers|(?:analyses?|tests?)|rendez vous|medecin|maladies|traitements?|medicaments?|resultats?)\b",
    r"\b(?:appointments?|tests?|results?|record|diseases?|medications?)\s+(?:for|of)\s+me\b",
)
DOCTOR_RECOMMENDATION_PATTERNS = (
    r"\b(?:which|what) (?:kind of )?(?:doctor|physician) (?:should|could|can) i (?:go|see|visit|consult)\b",
    r"\bwho should i (?:see|visit|consult)\b",
    r"\bwhich (?:doctor|physician) to (?:see|visit|consult)\b",
    r"\bquel(?:le)? medecin (?:dois je|devrais je|puis je)?\s*(?:aller|voir|consulter)\b",
    r"\bvers quel medecin (?:aller|consulter)\b",
)


def _asks_about_own_record(question: str) -> bool:
    text = normalize(question)
    return any(re.search(pattern, text) for pattern in OWN_RECORD_PATTERNS)


def _is_general_doctor_recommendation(question: str) -> bool:
    text = normalize(question)
    return any(re.search(pattern, text) for pattern in DOCTOR_RECOMMENDATION_PATTERNS)


FOLLOW_UP_CUES = (
    r"^(?:what about|how about|and for|and its|and their|does it|do they|what are its)\b",
    r"^(?:et pour|et ses|et son|et sa|qu en est il|et les|et la|et le)\b",
    r"^(?:وماذا عن|وشنية|وشنو|و أعراض|و علاج)",
)
EMERGENCY_PATTERNS = (
    r"\b(?:i have|i am having|im having|i cannot breathe|i can t breathe|right now)\b.*\b(?:severe chest pain|chest pain|difficulty breathing|trouble breathing|severe bleeding|fainting)\b",
    r"\b(?:j ai|je ressens|je n arrive pas a respirer|je ne peux pas respirer)\b.*\b(?:douleur thoracique|difficulte a respirer|saignement important|perte de connaissance)\b",
    r"(?:عندي وجيعة صدر قوية|لا استطيع التنفس|ما نجمش نتنفس)",
)


def _is_follow_up(question: str) -> bool:
    text = normalize(question)
    return any(re.search(pattern, text) for pattern in FOLLOW_UP_CUES)


def _is_emergency_signal(question: str) -> bool:
    text = normalize(question)
    return any(re.search(pattern, text) for pattern in EMERGENCY_PATTERNS)


def _emergency_explanations() -> dict[str, str]:
    return {
        "en": "If these symptoms are happening now or are severe, contact your local emergency services immediately. This assistant cannot assess an emergency.",
        "fr": "Si ces symptômes sont présents maintenant ou sont intenses, contactez immédiatement les services d’urgence locaux. Cet assistant ne peut pas évaluer une urgence.",
        "ar": "إذا كانت هذه الأعراض تحدث الآن أو كانت شديدة، فاتصل فورًا بخدمات الطوارئ المحلية. لا يستطيع هذا المساعد تقييم حالة طارئة.",
        "tn": "كان الأعراض هاذم موجودين توّا ولا قويّين، اتصل فورًا بالإسعاف المحلي. المساعد هذا ما ينجمش يقيّم حالة استعجالية.",
    }


def _model_language(lang: str) -> str:
    return "fr" if lang in ("ar", "tn") else lang


def _has(slots: dict[str, Any], need: str) -> bool:
    return any(bool(slots.get(part)) for part in need.split("|"))


INTERNAL_SLOTS = {"individual", "not_treatment", "sub_class", "property"}


def _public_slots(slots: dict[str, Any]) -> dict[str, Any]:
    # class_* slots only disambiguate the rules, they are not user facing filters
    return {key: value for key, value in slots.items() if key not in INTERNAL_SLOTS and not key.startswith("class_")}


def _model(lang: str) -> str:
    from .config import SPACY_MODELS

    return SPACY_MODELS.get(_model_language(lang), SPACY_MODELS["en"])


def _related_questions(intent: str, classifier: IntentClassifier, question: str, count: int = 4) -> list[str]:
    bank = [e["text"] for e in classifier.examples if e.get("intent") == intent and normalize(e["text"]) != normalize(question)]
    return bank[:count]
