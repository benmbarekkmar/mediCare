"""Integration tests for the NL -> SPARQL pipeline: routing, slots, templates, results."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import fuseki, sparql_builder  # noqa: E402
from app.evaluation import CASES, check_case  # noqa: E402
from app.intents import INTENTS  # noqa: E402
from app.lexicon import ONTOLOGY_TTL, _read_turtle_vocabulary  # noqa: E402
from app.normalize import detect_language, normalize, to_model_language  # noqa: E402
from app.pipeline import NlpPipeline  # noqa: E402

PIPELINE: NlpPipeline | None = None


@pytest.fixture(scope="module")
def pipeline() -> NlpPipeline:
    global PIPELINE
    if PIPELINE is None:
        PIPELINE = NlpPipeline()
        PIPELINE.ensure_ready()
    return PIPELINE


def store_available() -> bool:
    try:
        fuseki.select("SELECT ?s WHERE { ?s ?p ?o } LIMIT 1")
        return True
    except Exception:
        return False


@pytest.fixture(scope="module")
def store() -> None:
    if not store_available():
        pytest.skip("Fuseki is not reachable")


def questions() -> list[Any]:
    return [pytest.param(case, id=case.question[:48]) for case in CASES]


@pytest.mark.parametrize("case", questions())
def test_intent_is_routed(case, pipeline):
    """Every case question must reach its intent, with or without the store."""
    parsed = pipeline.parse(case.question)
    assert parsed["intent"] == case.intent, f"{case.question!r} -> {parsed['intent']}"
    if case.language:
        assert parsed["language"] == case.language
    if parsed["intent"] != "not_understood":
        assert parsed["sparql"], f"{case.question!r} produced no query"


@pytest.mark.parametrize("case", questions())
def test_result_shape(case, pipeline, store):
    outcome = check_case(pipeline, case)
    assert outcome.ok, "; ".join(outcome.problems)


def test_case_volume_and_coverage(pipeline):
    covered = {case.intent for case in CASES}
    assert len(CASES) >= 80
    assert len(covered) >= 40
    assert covered <= set(sparql_builder.TEMPLATES)


def test_accuracy_target(pipeline, store):
    outcomes = [check_case(pipeline, case) for case in CASES]
    accuracy = sum(1 for o in outcomes if o.ok) / len(outcomes)
    assert accuracy >= 0.90, [o.case.question for o in outcomes if not o.ok]


@pytest.mark.parametrize(
    "question,expected",
    [
        ("List the patients older than 40", "en"),
        ("Quels sont les symptomes du diabete ?", "fr"),
        ("Does Mariam have hypertension?", "en"),
        ("Combien de rendez vous sont confirmes ?", "fr"),
    ],
)
def test_language_detection(question, expected):
    assert detect_language(question) == expected


def test_normalisation_strips_accents_and_punctuation():
    assert normalize("Quelle est la dos\u00e9e d\u2019Amoxicilline ?") == "quelle est la dosee d amoxicilline"


@pytest.mark.parametrize(
    "question,language,expected",
    [
        ("ما هي أعراض مرض السكري؟", "ar", "quels sont symptomes maladie diabetes"),
        ("chneya a3radh diabete?", "tn", "quels symptomes diabete"),
    ],
)
def test_arabic_and_derja_language_bridge(question, language, expected):
    assert detect_language(question) == language
    assert normalize(to_model_language(question, language)) == expected


def test_follow_up_resolves_the_previous_disease(pipeline):
    result = pipeline.ask(
        "What about its treatments?",
        history=["Which symptoms does diabetes have?"],
    )
    assert result["intent"] == "disease_treatments"
    assert result["slots"]["disease"]


def test_flu_doctor_question_uses_directory_without_reading_patient_record(pipeline):
    result = pipeline.ask(
        "I have a flue so which doctor should I go?",
        own_patient="Patient_Ahmed",
    )
    assert result["intent"] == "doctors_by_specialty"
    assert result["slots"]["specialty"] == "GeneralPractitioner"
    assert result["slots"].get("disease") == "Influenza"
    assert result["safety"] == "care_navigation"
    assert result["sparql"]
    assert "own-data-injection" not in [step["step"] for step in result["pipeline"]]


def test_explicit_own_doctor_question_can_use_authenticated_patient(pipeline):
    result = pipeline.ask("Who is my doctor?", own_patient="Patient_Ahmed")
    assert result["intent"] == "patient_doctor"
    assert result["slots"]["patient"] == "Patient_Ahmed"


def test_emergency_symptoms_return_local_safety_guidance_without_sparql(pipeline):
    result = pipeline.ask("I have severe chest pain right now")
    assert result["intent"] == "not_understood"
    assert result["sparql"] == ""
    assert result["safety"] == "emergency"
    assert "emergency services" in result["explanation"]["en"]


@pytest.mark.parametrize(
    "question,slot,value",
    [
        ("List the patients older than 40", "age_operator", "gt"),
        ("Patients between 20 and 30 years", "age_min", 20),
        ("Which patients have blood type O+?", "blood_type", "O+"),
        ("How many appointments are pending?", "status", "Pending"),
        ("Show me the top 5 doctors", "limit", 5),
        ("Appointments after 2026-11-01", "date_operator", "after"),
    ],
)
def test_value_slots(question, slot, value, pipeline):
    parsed = pipeline.parse(question)
    assert parsed["slots"].get(slot) == value, parsed["slots"]


def test_every_intent_has_a_template():
    named = {intent.name for intent in INTENTS} - {"not_understood"}
    assert named <= set(sparql_builder.TEMPLATES)


def test_rdflib_reads_classes_and_individuals_from_the_turtle_ontology():
    rows = _read_turtle_vocabulary(ONTOLOGY_TTL)
    assert any(row["term"].endswith("#GeneralPractitioner") and row["kind"] == "class" for row in rows)
    assert any(row["term"].endswith("#Influenza") and row["kind"] == "individual" for row in rows)


def test_generated_queries_are_read_only_select_or_ask(pipeline):
    for case in CASES:
        query = pipeline.parse(case.question)["sparql"]
        if not query:
            continue
        body = "\n".join(line for line in query.splitlines() if not line.startswith("PREFIX"))
        assert re.match(r"\s*(SELECT|ASK)\b", body, re.IGNORECASE), case.question
        assert "INSERT" not in body.upper() and "DELETE" not in body.upper()
        assert "http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#" in query


def test_listed_queries_carry_a_limit(pipeline):
    for case in CASES:
        parsed = pipeline.parse(case.question)
        query = parsed["sparql"]
        if not query or parsed["intent"].startswith(("count_", "patient_has")):
            continue
        if "ASK" in query:
            continue
        assert "LIMIT" in query.upper(), case.question


def test_hostile_slots_cannot_escape_the_query():
    attack = 'a" } ; DROP ALL { ?s ?p ?o'
    assert sparql_builder.lit(attack) == '"a\\" } ; DROP ALL { ?s ?p ?o"'
    assert "\n" not in sparql_builder.lit(attack)
    with pytest.raises(sparql_builder.TemplateError):
        sparql_builder.safe_local("../../etc/passwd")
    query = sparql_builder.build("search_by_keyword", {"keyword": attack, "limit": 5})
    assert "DROP" not in query.split('"')[1]
    assert "LIMIT" in query


def test_answer_shape(pipeline):
    parsed = pipeline.parse("Which symptoms does diabetes have?")
    for key in ("question", "language", "intent", "confidence", "entities", "slots", "sparql", "explanation", "suggestions"):
        assert key in parsed
    assert parsed["entities"]
    assert parsed["explanation"]
    assert parsed["suggestions"]
    for entity in parsed["entities"]:
        assert entity["type"] in ("class", "individual", "property", "value")
        if entity["type"] == "value":
            # a value is a literal of the vocabulary, it names no ontology term
            assert entity["iri"] == ""
        else:
            assert entity["iri"].endswith(entity["id"])
