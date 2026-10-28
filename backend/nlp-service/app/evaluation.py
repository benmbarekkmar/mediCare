"""End to end accuracy: question -> intent -> SPARQL -> result asserted against the store.

Every case states the intent the pipeline must pick and what the executed query must
return, so a wrong template is caught even when the intent is right.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import fuseki
from .intents import INTENTS
from .pipeline import NlpPipeline

PREFIX_LINE = re.compile(r"^PREFIX\s", re.IGNORECASE)

_shared: "NlpPipeline | None" = None


def shared_pipeline() -> NlpPipeline:
    """One pipeline for the whole process: loading spaCy and fitting is not cheap."""
    global _shared
    if _shared is None:
        _shared = NlpPipeline()
    return _shared


@dataclass
class Case:
    """One question with its expected intent and the shape of its expected result."""

    question: str
    intent: str
    rows: int | None = None
    min_rows: int | None = None
    max_rows: int | None = None
    contains: str = ""
    value: str = ""
    truth: bool | None = None
    language: str | None = None


@dataclass
class Outcome:
    case: Case
    ok: bool
    intent: str
    confidence: float
    rows: int
    problems: list[str] = field(default_factory=list)


def is_ask(query: str) -> bool:
    body = "\n".join(line for line in query.splitlines() if not PREFIX_LINE.match(line))
    return bool(re.match(r"\s*ASK\b", body, re.IGNORECASE))


def _cells(rows: list[dict[str, str]]) -> list[str]:
    return [str(value) for row in rows for value in row.values()]


def check_case(pipeline: NlpPipeline, case: Case) -> Outcome:
    parsed = pipeline.ask(case.question)
    problems: list[str] = []
    if parsed["intent"] != case.intent:
        problems.append(f"intent {parsed['intent']} != {case.intent}")
    if case.language and parsed["language"] != case.language:
        problems.append(f"language {parsed['language']} != {case.language}")

    query = parsed["sparql"]
    rows = 0
    if not query:
        problems.append("no SPARQL generated")
        return Outcome(case, False, parsed["intent"], float(parsed["confidence"]), 0, problems)

    try:
        if is_ask(query):
            answer = fuseki.ask(query)
            rows = 1 if answer else 0
            if case.truth is not None and answer != case.truth:
                problems.append(f"ASK answer {answer} != {case.truth}")
        else:
            result = fuseki.select(query)
            rows = len(result)
            values = _cells(result)
            if case.rows is not None and rows != case.rows:
                problems.append(f"{rows} rows != {case.rows}")
            if case.min_rows is not None and rows < case.min_rows:
                problems.append(f"{rows} rows < {case.min_rows}")
            if case.max_rows is not None and rows > case.max_rows:
                problems.append(f"{rows} rows > {case.max_rows}")
            if case.contains and not any(case.contains.lower() in value.lower() for value in values):
                problems.append(f"no row contains {case.contains!r}")
            if case.value and not any(case.value == value for value in values):
                problems.append(f"no cell equals {case.value!r}")
    except fuseki.FusekiError as err:
        problems.append(f"store error: {err}")

    return Outcome(case, not problems, parsed["intent"], float(parsed["confidence"]), rows, problems)


def coverage(cases: list[Case]) -> dict[str, Any]:
    covered = {case.intent for case in cases}
    return {
        "intents": len(INTENTS),
        "covered": len(covered),
        "missing": sorted({intent.name for intent in INTENTS} - covered),
    }


def run(cases: list[Case] | None = None, pipeline: NlpPipeline | None = None) -> dict[str, Any]:
    """Run every case and return the overall, per intent and per language numbers."""
    cases = cases if cases is not None else CASES
    pipeline = pipeline or shared_pipeline()
    pipeline.ensure_ready()

    outcomes = [check_case(pipeline, case) for case in cases]
    per_intent: dict[str, dict[str, int]] = {}
    for outcome in outcomes:
        entry = per_intent.setdefault(outcome.case.intent, {"total": 0, "correct": 0})
        entry["total"] += 1
        entry["correct"] += 1 if outcome.ok else 0
    correct = sum(1 for outcome in outcomes if outcome.ok)
    return {
        "total": len(outcomes),
        "correct": correct,
        "accuracy": round(correct / len(outcomes), 4) if outcomes else 0.0,
        "per_intent": {
            name: {**counts, "accuracy": round(counts["correct"] / counts["total"], 3)}
            for name, counts in sorted(per_intent.items())
        },
        "failures": [
            {
                "question": outcome.case.question,
                "expected": outcome.case.intent,
                "intent": outcome.intent,
                "confidence": outcome.confidence,
                "rows": outcome.rows,
                "problems": outcome.problems,
            }
            for outcome in outcomes
            if not outcome.ok
        ],
        "coverage": coverage(cases),
    }


def evaluate(cases: list[Any] | None = None, pipeline: NlpPipeline | None = None) -> dict[str, Any]:
    """Run the bundled cases, or the ones sent as JSON objects over the API."""
    prepared = None
    if cases is not None:
        prepared = [case if isinstance(case, Case) else case_from(case) for case in cases]
    return run(prepared, pipeline)


def case_from(payload: dict[str, Any]) -> Case:
    """A case sent as JSON over the API, unknown keys ignored."""
    known = set(Case.__dataclass_fields__)
    return Case(**{key: value for key, value in payload.items() if key in known})


# --- the cases -------------------------------------------------------------------------------
# Expected row counts are the facts of the demo dataset loaded in Fuseki.

CASES: list[Case] = [
    # listing and counting
    Case("List all the doctors", "list_instances", rows=8),
    Case("Give me the list of hospitals", "list_instances", rows=4),
    Case("Show every symptom", "list_instances", rows=6),
    Case("Enumerate the diseases", "list_instances", rows=8),
    Case("Tous les medicaments disponibles", "list_instances", rows=10),
    Case("Liste des Hopitaux", "list_instances", rows=4),
    Case("How many doctors are there?", "count_instances", value="8"),
    Case("Combien de patients ?", "count_instances", value="10"),
    Case("Number of hospitals", "count_instances", value="4"),
    Case("How many medications exist?", "count_instances", value="10"),
    Case("Total number of appointments", "count_instances", value="10"),
    Case("Quel est le nombre de symptomes ?", "count_instances", value="6"),
    # one individual in full
    Case("Describe Ahmed Ben Ali", "describe_individual", min_rows=15),
    Case("Give me the full record of Mariam Haddad", "describe_individual", min_rows=15),
    Case("Details sur Charles Nicolle Hospital", "describe_individual", min_rows=8),
    # disease and symptom navigation
    Case("Which symptoms does diabetes have?", "disease_symptoms", rows=2, contains="Fatigue"),
    Case("Quels sont les symptomes de la grippe ?", "disease_symptoms", rows=3, contains="Fever"),
    Case("Symptoms of diabetes", "disease_symptoms", rows=2),
    Case("What treatments exist for diabetes?", "disease_treatments", rows=1, contains="medication therapy"),
    Case("How to treat pneumonia?", "disease_treatments", min_rows=1, contains="Antibiotic"),
    Case("Quels sont les traitements de l hypertension ?", "disease_treatments", rows=1),
    Case("Medications used for hypertension", "disease_medications", rows=2, contains="Amlodipine"),
    Case("What drugs are prescribed for pneumonia?", "disease_medications", min_rows=1),
    Case("Quels medicaments pour traiter le diabete ?", "disease_medications", min_rows=1, contains="Metformin"),
    Case("What is diabetes?", "disease_description", min_rows=1),
    Case("Define hypertension", "disease_description", min_rows=1),
    Case("Qu est ce que la grippe ?", "disease_description", min_rows=1),
    Case("Which diseases cause fever?", "symptom_diseases", rows=3, contains="Influenza"),
    Case("Quelles maladies provoquent de la fievre ?", "symptom_diseases", rows=3),
    Case("Which illnesses are linked to chest pain?", "symptom_diseases", min_rows=1),
    # patients and diseases
    Case("Patients with hypertension", "disease_patients", rows=2, contains="Karim"),
    Case("Quels patients souffrent de diabete ?", "disease_patients", rows=2, contains="Ahmed"),
    Case("Who has influenza?", "disease_patients", rows=1, contains="Sara"),
    Case("What diseases does Ahmed Ben Ali have?", "patient_diseases", rows=1, contains="Diabetes"),
    Case("Quelles maladies pour Karim Mejri ?", "patient_diseases", rows=1, contains="Hypertension"),
    # the care team
    Case("Who is the doctor of Ahmed?", "patient_doctor", rows=1, contains="Salma"),
    Case("Quel est le medecin de Mariam Haddad ?", "patient_doctor", rows=1, contains="Ali"),
    Case("List the patients of Salma Ben Amor", "doctor_patients", rows=3),
    Case("Quels sont les patients du docteur Ali Trabelsi ?", "doctor_patients", rows=1, contains="Mariam"),
    Case("Which department does Ali Trabelsi work in?", "doctor_department", rows=1, contains="Cardiology"),
    Case("Dans quel service travaille Hatem Mansour ?", "doctor_department", rows=1, contains="Neurology"),
    Case("Which hospital employs Hatem Mansour?", "doctor_hospital", rows=1, contains="Rabta"),
    Case("Dans quel hopital travaille Nadia Gharbi ?", "doctor_hospital", rows=1, contains="Charles Nicolle"),
    Case("Doctors working in cardiology", "doctors_by_specialty", rows=2, contains="Ali Trabelsi"),
    Case("Quels sont les cardiologues ?", "doctors_by_specialty", rows=2),
    Case("List the emergency physicians", "doctors_by_specialty", rows=2),
    Case("Show the neurologists", "doctors_by_specialty", rows=1),
    Case("Which doctors work in the cardiology department?", "department_doctors", rows=2),
    Case("Medecins du service de neurologie", "department_doctors", rows=1, contains="Hatem"),
    Case("Docteurs du service des urgences", "department_doctors", min_rows=1),
    Case("Which hospital hosts the neurology department?", "hospitals_by_department_type", rows=1, contains="Rabta"),
    Case("Which hospital is the Neurology Department - La Rabta Hospital part of?", "department_hospital", rows=1, contains="Rabta"),
    Case("Dans quel hopital se trouve urgence 01 ?", "department_hospital", rows=1, contains="Charles Nicolle"),
    Case("Quel hopital heberge le service de dermatologie ?", "hospitals_by_department_type", rows=1, contains="Charles Nicolle"),
    Case("Which hospitals have a cardiology department?", "hospitals_by_department_type", rows=2),
    Case("List the departments of Charles Nicolle Hospital", "hospital_departments", rows=4),
    Case("Quels sont les services de La Rabta Hospital ?", "hospital_departments", rows=2),
    Case("Which doctors work at La Rabta Hospital?", "hospital_doctors", rows=2),
    Case("Medecins de Clinique Al Amal", "hospital_doctors", rows=1, contains="Rim"),
    Case("Which patients are followed in La Rabta Hospital?", "followed_in_hospital", rows=2),
    Case("Quels patients sont suivis a Charles Nicolle Hospital ?", "followed_in_hospital", rows=6),
    # tests
    Case("Which tests did Ahmed Ben Ali undergo?", "patient_tests", rows=1, contains="Normal"),
    Case("Quels examens pour Fatma Gharsallah ?", "patient_tests", rows=2),
    Case("List the blood tests", "tests_by_type", rows=5),
    Case("Show the MRI examinations", "tests_by_type", rows=1),
    Case("Liste les radiographies", "tests_by_type", rows=3),
    Case("Which tests have a normal result?", "tests_by_result", rows=6, contains="Normal"),
    Case("Examens avec un resultat normal", "tests_by_result", min_rows=1),
    # appointments
    Case("Appointments of Ahmed Ben Ali", "patient_appointments", rows=1),
    Case("Quels sont les rendez vous de Mariam Haddad ?", "patient_appointments", rows=1),
    Case("How many appointments are pending?", "appointments_by_status", rows=3),
    Case("List the confirmed appointments", "appointments_by_status", rows=5),
    Case("Quels rendez vous sont annules ?", "appointments_by_status", rows=0),
    Case("Appointments in the cardiology department", "appointments_by_department", rows=2),
    Case("Emergency appointments scheduled", "appointments_by_type", rows=3),
    Case("List the consultations", "appointments_by_type", rows=5),
    Case("Appointments after 2026-11-01", "appointments_by_date", rows=4),
    Case("Appointments on 2026-11-03", "appointments_by_date", rows=1),
    Case("Rendez vous du 2026-10-25", "appointments_by_date", rows=1),
    Case("Upcoming appointments", "upcoming_appointments", min_rows=1),
    Case("Quels sont les prochains rendez vous ?", "upcoming_appointments", min_rows=1),
    # patient categories and filters
    Case("Patients with chronic diseases", "chronic_patients", rows=6),
    Case("List the emergency patients", "emergency_patients", rows=3),
    Case("Which patients are children?", "patients_by_age_group", rows=2),
    Case("List the elderly patients", "patients_by_age_group", rows=2),
    Case("Show the adult patients", "patients_by_age_group", rows=6),
    Case("List the patients older than 40", "patients_by_age_comparator", rows=5, contains="Ahmed"),
    Case("Quels patients ont plus de 70 ans ?", "patients_by_age_comparator", rows=1, contains="Fatma"),
    Case("Patients younger than 18", "patients_by_age_comparator", rows=2),
    Case("Patients between 20 and 30 years old", "patients_by_age_comparator", rows=2),
    Case("Patients with blood type O+", "patients_by_blood_type", rows=2),
    Case("List the patients with AB+ blood", "patients_by_blood_type", rows=1, contains="Mariam"),
    Case("Female patients", "patients_by_gender", rows=5),
    Case("List the male patients", "patients_by_gender", rows=5),
    # medications and treatments
    Case("Dosage of Metformin", "medication_dosage", rows=1, contains="500 mg"),
    Case("Quelle est la posologie de l amoxicilline ?", "medication_dosage", rows=1, contains="1 g"),
    Case("How much Amlodipine should be taken?", "medication_dosage", rows=1, contains="5 mg"),
    Case("List the antibiotics", "medications_by_class", rows=2),
    Case("Quels sont les antalgiques ?", "medications_by_class", rows=2),
    Case("Which medications are antiviral?", "medications_by_class", rows=1, contains="Oseltamivir"),
    Case("What medications does the antiviral therapy include?", "treatment_medications", min_rows=1, contains="Oseltamivir"),
    Case("Medications of the hypertension medication therapy", "treatment_medications", rows=2),
    Case("How long does the antiviral therapy last?", "treatment_duration", rows=1, contains="5 days"),
    Case("Quelle est la duree du traitement du diabete ?", "treatment_duration", rows=1, contains="Lifelong"),
    # statistics
    Case("What are the most common diseases?", "top_diseases_by_patients", min_rows=2, contains="Diabetes"),
    Case("Quelle est la maladie la plus frequente ?", "top_diseases_by_patients", min_rows=1),
    Case("Which medications treat the most diseases?", "top_medications_by_diseases", min_rows=1),
    Case("Les medicaments les plus prescrits", "top_medications_by_diseases", min_rows=1),
    Case("How many patients does each doctor have?", "patients_per_doctor", rows=8, contains="Salma"),
    Case("Patient count per doctor", "patients_per_doctor", rows=8),
    Case("Doctors without patients", "doctors_without_patients", rows=0),
    Case("Which hospitals are public?", "hospitals_by_type", rows=2),
    Case("List the private hospitals", "hospitals_by_type", rows=1, contains="Al Amal"),
    Case("List the cardiology departments", "departments_by_type", rows=2),
    Case("Quels services des urgences existent ?", "departments_by_type", rows=2),
    # search and boolean checks
    Case('Search for individuals named "Ahmed"', "search_by_keyword", min_rows=1),
    Case('Find medications called "rami"', "search_by_keyword", rows=1, contains="Ramipril"),
    Case("Does Mariam have hypertension?", "ask_boolean", truth=True),
    Case("Does Ahmed have hypertension?", "ask_boolean", truth=False),
    Case("Est ce que Karim souffre dhypertension ?", "ask_boolean", truth=True),
    Case("Does diabetes cause fatigue?", "ask_boolean", truth=True),
    Case("Is HypertensionTreatment using Amlodipine?", "ask_boolean", truth=True),
    # typos, synonyms and word order variations
    Case("What are the sumptoms of diabetes?", "disease_symptoms", rows=2, contains="Fatigue"),
    Case("Quels sont les symptèmes de la grippe ?", "disease_symptoms", rows=3),
    Case("Medications used for hypertenshn", "disease_medications", rows=2),
    Case("the dosage of medformin", "medication_dosage", rows=1, contains="500 mg"),
    Case("list the anitbiotics", "medications_by_class", rows=2),
    Case("List the patientes older than 40", "patients_by_age_comparator", rows=5),
    Case("How many apointements are pending?", "appointments_by_status", rows=3),
    Case("Rendez vous en attente combien ?", "appointments_by_status", rows=3),
    Case("Docteurs sans patients", "doctors_without_patients", rows=0),
    Case("the neurology department is in which hospital?", "hospitals_by_department_type", rows=1, contains="Rabta"),
    Case("Ahmed Ben Ali diseases what are", "patient_diseases", rows=1, contains="Diabetes"),
    Case("of Ahmed, who is the doctor?", "patient_doctor", rows=1, contains="Salma"),
    # an unquoted keyword read off the dependency tree
    Case("Find the hospitals that mention Rabta", "search_by_keyword", min_rows=1, contains="Rabta"),
    Case("search medications containing Amox", "search_by_keyword", rows=1, contains="Amoxicillin"),
    Case("Cherche les hopitaux qui mentionnent Rabta", "search_by_keyword", min_rows=1, contains="Rabta"),
]
