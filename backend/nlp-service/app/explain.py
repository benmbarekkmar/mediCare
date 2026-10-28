"""Human readable explanation of a plan, in the language of the question."""

from __future__ import annotations

from typing import Any

from .intents import INTENTS_BY_NAME
from .lexicon import Lexicon

LABEL_SLOTS = [
    ("patient", "patient"),
    ("doctor", "doctor"),
    ("disease", "disease"),
    ("symptom", "symptom"),
    ("treatment", "treatment"),
    ("medication", "medication"),
    ("test_type", "test type"),
    ("test", "test"),
    ("department", "department"),
    ("department_type", "department type"),
    ("hospital", "hospital"),
    ("hospital_type", "hospital type"),
    ("specialty", "specialty"),
    ("medication_class", "medication class"),
    ("appointment_type", "appointment type"),
    ("age_group", "age group"),
    ("status", "status"),
    ("gender", "gender"),
    ("blood_type", "blood group"),
    ("class", "class"),
    ("keyword", "keyword"),
]


def _resolved(slots: dict[str, Any], lexicon: Lexicon) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for slot, label in LABEL_SLOTS:
        value = slots.get(slot)
        if not value or isinstance(value, bool):
            continue
        term = lexicon.resolve(str(value))
        display = term.aliases[0] if term and term.aliases else str(value)
        out.append((label, display))
    return out


def explain(intent: str, slots: dict[str, Any], lang: str, lexicon: Lexicon) -> dict[str, str]:
    """Both languages are always returned, the UI picks the one it displays."""
    definition = INTENTS_BY_NAME.get(intent)
    base_en = definition.explanation.get("en", "") if definition else ""
    base_fr = definition.explanation.get("fr", "") if definition else ""
    parts = _resolved(slots, lexicon)
    english = base_en
    french = base_fr
    if parts:
        english += " Resolved: " + ", ".join(f"{label} = {value}" for label, value in parts) + "."
        french += " Termes reconnus : " + ", ".join(f"{label} = {value}" for label, value in parts) + "."
    if slots.get("age_operator"):
        english += f" Age filter {slots['age_operator']} {slots.get('age_value', '')}."
        french += f" Filtre d age {slots['age_operator']} {slots.get('age_value', '')}."
    if slots.get("limit"):
        english += f" Limited to {slots['limit']} rows."
        french += f" Limite a {slots['limit']} lignes."
    return {"en": english.strip(), "fr": french.strip(), "chosen": english if lang != "fr" else french.strip()}
