"""Template library: one parameterised SPARQL template per intent.

Nothing here ever concatenates raw question text into a query. Every value that
reaches a query is either a validated ontology local name or an escaped literal,
and every SELECT carries a LIMIT.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from .config import settings
from .normalize import normalize

ONT = "http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#"

PREFIX_BLOCK = (
    "PREFIX ont: <" + ONT + ">\n"
    "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n"
    "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n"
    "PREFIX owl: <http://www.w3.org/2002/07/owl#>\n"
    "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n"
    "PREFIX skos: <http://www.w3.org/2004/02/skos/core#>\n"
)

LOCAL_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,127}$")
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")

# the single label property each class uses in this ontology
NAME_PREDICATE = {
    "Patient": "hasName",
    "Doctor": "doctorName",
    "Disease": "diseaseName",
    "Symptom": "symptomName",
    "Treatment": "treatmentName",
    "Medication": "medicationName",
    "Hospital": "hospitalName",
    "MedicalDepartment": "departmentName",
    "MedicalTest": "",
    "MedicalAppointment": "",
}

CLASS_BY_ENTITY = {v: k for k, v in NAME_PREDICATE.items()}
CLASS_BY_ENTITY.update({"Test": "MedicalTest", "Appointment": "MedicalAppointment"})


class TemplateError(ValueError):
    pass


def safe_local(value: Any) -> str:
    """Validate an ontology local name before it is written into an IRI."""
    text = str(value or "")
    if not LOCAL_NAME.match(text):
        raise TemplateError(f"Unsafe identifier: {text!r}")
    return text


def escape(value: Any) -> str:
    """Escape a JS-free string for a SPARQL one line double quoted literal."""
    text = str(value if value is not None else "")
    text = text.replace("\\", "\\\\").replace('"', '\\"')
    text = text.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return CONTROL_CHARS.sub("", text)


def lit(value: Any) -> str:
    return f'"{escape(value)}"'


def iri(local: Any) -> str:
    return f"ont:{safe_local(local)}"


def _label_join(cls: str, var: str, alias: str) -> str:
    predicate = NAME_PREDICATE.get(cls, "")
    if predicate:
        return f"  OPTIONAL {{ {var} ont:{safe_local(predicate)} ?{alias} }}"
    return f"  OPTIONAL {{ {var} rdfs:label ?{alias} }}"


def _select(subject: str, cls: str, extra: str = "", order: str = "", limit: int = 0) -> str:
    name = "itemName"
    body = f"SELECT DISTINCT ?{subject} ?{name} WHERE {{\n  ?{subject} a ont:{safe_local(cls)} .\n"
    body += _label_join(cls, f"?{subject}", name) + "\n"
    if extra:
        body += extra.rstrip() + "\n"
    # ORDER BY and LIMIT are solution modifiers, they live after the group
    if order:
        body += f"}}\nORDER BY {order}\n"
    else:
        body += "}\n"
    return body + f"LIMIT {limit or settings.default_limit}"


def _filtered(subject: str, cls: str, patterns: str, order: str = "", limit: int = 0) -> str:
    name = "itemName"
    body = f"SELECT DISTINCT ?{subject} ?{name} WHERE {{\n  ?{subject} a ont:{safe_local(cls)} .\n"
    body += _label_join(cls, f"?{subject}", name) + "\n"
    body += patterns.rstrip() + "\n"
    if order:
        body += f"}}\nORDER BY {order}\n"
    else:
        body += "}\n"
    return body + f"LIMIT {limit or settings.default_limit}"


def _count(cls: str, patterns: str = "") -> str:
    body = f"SELECT (COUNT(DISTINCT ?s) AS ?count) WHERE {{\n  ?s a ont:{safe_local(cls)} .\n"
    if patterns:
        body += patterns.rstrip() + "\n"
    return body + "}"


def _needs(slots: dict[str, Any], *keys: str) -> None:
    for key in keys:
        if not slots.get(key):
            raise TemplateError(f"Missing slot: {key}")


def _department_term(slots: dict[str, Any]) -> tuple[str, str]:
    """A named department IRI, or a fresh variable constrained to a department type."""
    return _type_or_iri(slots, "department", "department_type", "department")


def _hospital_term(slots: dict[str, Any]) -> tuple[str, str]:
    return _type_or_iri(slots, "hospital", "hospital_type", "hospital")


def _type_or_iri(slots: dict[str, Any], individual: str, type_slot: str, var: str) -> tuple[str, str]:
    """(subject, extra patterns) accepting either one individual or a whole subclass."""
    if slots.get(individual):
        return iri(slots[individual]), ""
    if slots.get(type_slot):
        name = f"?{var}"
        return name, f"  {name} a {iri(slots[type_slot])} .\n"
    raise TemplateError(f"Missing slot: {individual} or {type_slot}")


def _clamp(limit: Any) -> int:
    try:
        value = int(limit)
    except (TypeError, ValueError):
        return settings.default_limit
    return max(1, min(value, settings.max_limit))


# --- templates ------------------------------------------------------------------------------


def list_instances(slots: dict[str, Any]) -> str:
    cls = safe_local(slots["class"])
    return _select("s", cls, limit=_clamp(slots.get("limit")))


def count_instances(slots: dict[str, Any]) -> str:
    return _count(safe_local(slots["class"]))


def describe_individual(slots: dict[str, Any]) -> str:
    _needs(slots, "individual")
    subject = iri(slots["individual"])
    return (
        "SELECT DISTINCT ?direction ?predicate ?value WHERE {\n"
        f"  {{ BIND(\"out\" AS ?direction) {subject} ?predicate ?value }}\n"
        "    UNION\n"
        f'  {{ BIND("in" AS ?direction) ?other ?predicate {subject} FILTER(isIRI(?other)) BIND(?other AS ?value) }}\n'
        f"}}\nLIMIT {_clamp(slots.get('limit', 200))}"
    )


def disease_symptoms(slots: dict[str, Any]) -> str:
    _needs(slots, "disease")
    return (
        "SELECT DISTINCT ?symptom ?symptomName WHERE {\n"
        f"  {iri(slots['disease'])} ont:hasSymptom ?symptom .\n"
        "  OPTIONAL { ?symptom ont:symptomName ?symptomName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def disease_treatments(slots: dict[str, Any]) -> str:
    _needs(slots, "disease")
    return (
        "SELECT DISTINCT ?treatment ?treatmentName ?duration WHERE {\n"
        f"  {iri(slots['disease'])} ont:hasTreatment ?treatment .\n"
        "  OPTIONAL { ?treatment ont:treatmentName ?treatmentName }\n"
        "  OPTIONAL { ?treatment ont:treatmentDuration ?duration }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def disease_medications(slots: dict[str, Any]) -> str:
    _needs(slots, "disease")
    return (
        "SELECT DISTINCT ?medication ?medicationName ?dosage WHERE {\n"
        f"  {iri(slots['disease'])} ont:hasTreatment / ont:usesMedication ?medication .\n"
        "  OPTIONAL { ?medication ont:medicationName ?medicationName }\n"
        "  OPTIONAL { ?medication ont:medicationDosage ?dosage }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def disease_description(slots: dict[str, Any]) -> str:
    _needs(slots, "disease")
    return (
        "SELECT DISTINCT ?description WHERE {\n"
        f"  {iri(slots['disease'])} ont:diseaseDescription ?description .\n"
        f"}}\nLIMIT {_clamp(slots.get('limit', 5))}"
    )


def symptom_diseases(slots: dict[str, Any]) -> str:
    _needs(slots, "symptom")
    return _filtered("d", "Disease", f"  ?d ont:hasSymptom {iri(slots['symptom'])} .", limit=_clamp(slots.get("limit")))


def disease_patients(slots: dict[str, Any]) -> str:
    _needs(slots, "disease")
    return _filtered("s", "Patient", f"  ?s ont:hasDisease {iri(slots['disease'])} .", limit=_clamp(slots.get("limit")))


def patient_diseases(slots: dict[str, Any]) -> str:
    _needs(slots, "patient")
    return (
        "SELECT DISTINCT ?disease ?diseaseName WHERE {\n"
        f"  {iri(slots['patient'])} ont:hasDisease ?disease .\n"
        "  OPTIONAL { ?disease ont:diseaseName ?diseaseName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def patient_doctor(slots: dict[str, Any]) -> str:
    _needs(slots, "patient")
    return (
        "SELECT DISTINCT ?doctor ?doctorName ?departmentName WHERE {\n"
        f"  {iri(slots['patient'])} ont:treatedBy ?doctor .\n"
        "  OPTIONAL { ?doctor ont:doctorName ?doctorName }\n"
        "  OPTIONAL { ?doctor ont:worksIn ?department . ?department ont:departmentName ?departmentName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit', 10))}"
    )


def doctor_patients(slots: dict[str, Any]) -> str:
    _needs(slots, "doctor")
    return _filtered(
        "p", "Patient", f"  ?p ont:treatedBy {iri(slots['doctor'])} .", limit=_clamp(slots.get("limit"))
    )


def doctor_department(slots: dict[str, Any]) -> str:
    _needs(slots, "doctor")
    return (
        "SELECT DISTINCT ?department ?departmentName WHERE {\n"
        f"  {iri(slots['doctor'])} ont:worksIn ?department .\n"
        "  OPTIONAL { ?department ont:departmentName ?departmentName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit', 10))}"
    )


def doctor_hospital(slots: dict[str, Any]) -> str:
    _needs(slots, "doctor")
    return (
        "SELECT DISTINCT ?hospital ?hospitalName WHERE {\n"
        f"  {iri(slots['doctor'])} ont:worksIn / ont:locatedIn ?hospital .\n"
        "  OPTIONAL { ?hospital ont:hospitalName ?hospitalName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit', 10))}"
    )


def doctors_by_specialty(slots: dict[str, Any]) -> str:
    _needs(slots, "specialty")
    return _filtered("d", "Doctor", f"  ?d a {iri(slots['specialty'])} .", limit=_clamp(slots.get("limit")))


def department_doctors(slots: dict[str, Any]) -> str:
    term, extra = _department_term(slots)
    return _filtered(
        "d",
        "Doctor",
        f"  ?d ont:worksIn {term} .\n{extra}",
        limit=_clamp(slots.get("limit")),
    )


def department_hospital(slots: dict[str, Any]) -> str:
    term, extra = _department_term(slots)
    return (
        "SELECT DISTINCT ?hospital ?hospitalName WHERE {\n"
        f"{extra}  {term} ont:locatedIn ?hospital .\n"
        "  OPTIONAL { ?hospital ont:hospitalName ?hospitalName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit', 10))}"
    )


def hospital_departments(slots: dict[str, Any]) -> str:
    term, extra = _hospital_term(slots)
    return (
        "SELECT DISTINCT ?department ?departmentName WHERE {\n"
        f"  ?department ont:locatedIn {term} .\n{extra}"
        "  OPTIONAL { ?department ont:departmentName ?departmentName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def hospital_doctors(slots: dict[str, Any]) -> str:
    term, extra = _hospital_term(slots)
    return _filtered(
        "d",
        "Doctor",
        f"  ?d ont:worksIn ?unit .\n  ?unit ont:locatedIn {term} .\n{extra}",
        limit=_clamp(slots.get("limit")),
    )


def followed_in_hospital(slots: dict[str, Any]) -> str:
    term, extra = _hospital_term(slots)
    return _filtered(
        "p",
        "Patient",
        f"  {{ ?p ont:followedInHospital {term} }}\n"
        f"    UNION\n"
        f"  {{ ?p ont:treatedBy ?d . ?d ont:worksIn ?dep . ?dep ont:locatedIn {term} }}\n{extra}",
        limit=_clamp(slots.get("limit")),
    )


def patient_tests(slots: dict[str, Any]) -> str:
    _needs(slots, "patient")
    return (
        "SELECT DISTINCT ?test ?testType ?result ?date WHERE {\n"
        f"  {iri(slots['patient'])} ont:undergoesTest ?test .\n"
        "  OPTIONAL { ?test rdf:type ?testType FILTER(STRSTARTS(STR(?testType), str(ont:)) && ?testType != ont:MedicalTest) }\n"
        "  OPTIONAL { ?test ont:testResult ?result }\n"
        "  OPTIONAL { ?test ont:testDate ?date }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def tests_by_type(slots: dict[str, Any]) -> str:
    _needs(slots, "test_type")
    return (
        "SELECT DISTINCT ?test ?result ?date ?patientName WHERE {\n"
        f"  ?test a {iri(slots['test_type'])} .\n"
        "  OPTIONAL { ?test ont:testResult ?result }\n"
        "  OPTIONAL { ?test ont:testDate ?date }\n"
        "  OPTIONAL { ?test ont:isTestOf ?p . ?p ont:hasName ?patientName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def tests_by_result(slots: dict[str, Any]) -> str:
    _needs(slots, "result")
    return (
        "SELECT DISTINCT ?test ?result ?date ?patientName WHERE {\n"
        "  ?test ont:testResult ?result .\n"
        f"  FILTER(CONTAINS(LCASE(STR(?result)), {lit(slots['result'])}))\n"
        "  OPTIONAL { ?test ont:testDate ?date }\n"
        "  OPTIONAL { ?test ont:isTestOf ?p . ?p ont:hasName ?patientName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def patient_appointments(slots: dict[str, Any]) -> str:
    _needs(slots, "patient")
    return _appointment_block(f"?appointment ont:appointmentOf {iri(slots['patient'])} .", slots)


def appointments_by_status(slots: dict[str, Any]) -> str:
    _needs(slots, "status")
    return _appointment_block(f"?appointment ont:appointmentStatus {lit(slots['status'])} .", slots)


def appointments_by_department(slots: dict[str, Any]) -> str:
    term, extra = _department_term(slots)
    return _appointment_block(f"?appointment ont:belongsToDepartment {term} .{extra}", slots)


def appointments_by_type(slots: dict[str, Any]) -> str:
    _needs(slots, "appointment_type")
    return _appointment_block(f"?appointment a {iri(slots['appointment_type'])} .", slots)


def _appointment_block(pattern: str, slots: dict[str, Any]) -> str:
    body = (
        "SELECT DISTINCT ?appointment ?date ?status ?patientName ?departmentName WHERE {\n"
        "  ?appointment a ont:MedicalAppointment ; ont:appointmentDate ?date ; ont:appointmentStatus ?status .\n"
        f"  {pattern}\n"
        "  OPTIONAL { ?appointment ont:appointmentOf ?p . ?p ont:hasName ?patientName }\n"
        "  OPTIONAL { ?appointment ont:belongsToDepartment ?dep . ?dep ont:departmentName ?departmentName }\n"
    )
    if slots.get("date_after"):
        body += f'  FILTER(?date >= "{escape(slots["date_after"])}T00:00:00"^^xsd:dateTime)\n'
    if slots.get("date_before"):
        body += f'  FILTER(?date <= "{escape(slots["date_before"])}T23:59:59"^^xsd:dateTime)\n'
    if slots.get("upcoming"):
        body += "  FILTER(?date >= now())\n"
    order = "ASC" if slots.get("order") == "asc" else "DESC" if slots.get("order") == "desc" else ""
    if order:
        body += f"}}\nORDER BY {order}(?date)\n"
    else:
        body += "}\n"
    return body + f"LIMIT {_clamp(slots.get('limit'))}"


def upcoming_appointments(slots: dict[str, Any]) -> str:
    merged = dict(slots)
    merged["upcoming"] = True
    merged.setdefault("order", "asc")
    return _appointment_block("", merged)


def appointments_by_date(slots: dict[str, Any]) -> str:
    merged = dict(slots)
    date = merged.get("date") or merged.get("date_after") or merged.get("date_before")
    if not date:
        raise TemplateError("Missing slot: date")
    operator = merged.get("date_operator", "")
    if operator in ("after", "from", "next"):
        merged["date_after"] = date
    elif operator in ("before", "until", "previous"):
        merged["date_before"] = date
    else:
        merged["date_after"], merged["date_before"] = date, date
    return _appointment_block("", merged)


def _patients_by_type(cls: str, slots: dict[str, Any]) -> str:
    return _filtered("p", "Patient", f"  ?p a {iri(cls)} .", limit=_clamp(slots.get("limit")))


def emergency_patients(slots: dict[str, Any]) -> str:
    return _patients_by_type("EmergencyPatient", slots)


def chronic_patients(slots: dict[str, Any]) -> str:
    return _patients_by_type("ChronicPatient", slots)


def patients_by_age_group(slots: dict[str, Any]) -> str:
    _needs(slots, "age_group")
    return _patients_by_type(slots["age_group"], slots)


def patients_by_age_comparator(slots: dict[str, Any]) -> str:
    operator, value = slots.get("age_operator"), slots.get("age_value")
    if operator == "between":
        low, high = slots.get("age_min"), slots.get("age_max")
        if low is None or high is None:
            raise TemplateError("Missing slot: age_min/age_max")
        condition = f"  FILTER(?age >= {int(low)} && ?age <= {int(high)})\n"
    else:
        if value is None:
            raise TemplateError("Missing slot: age_value")
        symbol = {"gt": ">", "lt": "<", "eq": "="}.get(str(operator), "=")
        condition = f"  FILTER(?age {symbol} {int(value)})\n"
    return _filtered(
        "p",
        "Patient",
        "  ?p ont:hasAge ?age .\n" + condition.rstrip(),
        order="ASC(?age)",
        limit=_clamp(slots.get("limit")),
    )


def patients_by_blood_type(slots: dict[str, Any]) -> str:
    _needs(slots, "blood_type")
    return _filtered("p", "Patient", f'  ?p ont:hasBloodType {lit(slots["blood_type"])} .', limit=_clamp(slots.get("limit")))


def patients_by_gender(slots: dict[str, Any]) -> str:
    _needs(slots, "gender")
    return _filtered("p", "Patient", f'  ?p ont:hasGender {lit(slots["gender"])} .', limit=_clamp(slots.get("limit")))


def medication_dosage(slots: dict[str, Any]) -> str:
    _needs(slots, "medication")
    return (
        "SELECT DISTINCT ?dosage ?medicationName WHERE {\n"
        f"  {iri(slots['medication'])} ont:medicationName ?medicationName ; ont:medicationDosage ?dosage .\n"
        f"}}\nLIMIT {_clamp(slots.get('limit', 5))}"
    )


def medications_by_class(slots: dict[str, Any]) -> str:
    _needs(slots, "medication_class")
    return (
        "SELECT DISTINCT ?medication ?medicationName ?dosage WHERE {\n"
        f"  ?medication a {iri(slots['medication_class'])} .\n"
        "  OPTIONAL { ?medication ont:medicationName ?medicationName }\n"
        "  OPTIONAL { ?medication ont:medicationDosage ?dosage }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def treatment_medications(slots: dict[str, Any]) -> str:
    _needs(slots, "treatment")
    return (
        "SELECT DISTINCT ?medication ?medicationName ?dosage WHERE {\n"
        f"  {iri(slots['treatment'])} ont:usesMedication ?medication .\n"
        "  OPTIONAL { ?medication ont:medicationName ?medicationName }\n"
        "  OPTIONAL { ?medication ont:medicationDosage ?dosage }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def treatment_duration(slots: dict[str, Any]) -> str:
    _needs(slots, "treatment")
    return (
        "SELECT DISTINCT ?duration ?treatmentName WHERE {\n"
        f"  {iri(slots['treatment'])} ont:treatmentName ?treatmentName ; ont:treatmentDuration ?duration .\n"
        f"}}\nLIMIT {_clamp(slots.get('limit', 5))}"
    )


def search_by_keyword(slots: dict[str, Any]) -> str:
    _needs(slots, "keyword")
    needle = lit(normalize(slots["keyword"]))
    cls = slots.get("class")
    if cls:
        head = f"?s a ont:{safe_local(cls)} .\n"
        head += _label_join(safe_local(cls), "?s", "itemName") + "\n"
        select_vars = "?s ?itemName"
    else:
        head = ""
        select_vars = "?s ?itemName ?itemClass"
    return (
        f"SELECT DISTINCT {select_vars} WHERE {{\n  {head}"
        "  {\n    ?s rdfs:label ?itemName\n    FILTER(CONTAINS(LCASE(STR(?itemName)), " + needle + "))\n  }\n"
        "  UNION\n  {\n"
        "    ?s ?namePredicate ?itemName\n"
        "    FILTER(?namePredicate IN (ont:hasName, ont:doctorName, ont:diseaseName, ont:symptomName,"
        " ont:treatmentName, ont:medicationName, ont:hospitalName, ont:departmentName))\n"
        "    FILTER(CONTAINS(LCASE(STR(?itemName)), " + needle + "))\n  }\n"
        "  UNION\n  {\n"
        "    ?s skos:altLabel ?alias\n"
        "    FILTER(CONTAINS(LCASE(STR(?alias)), " + needle + "))\n"
        "    BIND(?alias AS ?itemName)\n  }\n"
        "  OPTIONAL { ?s rdf:type ?itemClass FILTER(STRSTARTS(STR(?itemClass), str(ont:))) }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def top_diseases_by_patients(slots: dict[str, Any]) -> str:
    return (
        "SELECT DISTINCT ?disease ?diseaseName (COUNT(DISTINCT ?p) AS ?patientCount) WHERE {\n"
        "  ?p ont:hasDisease ?disease .\n"
        "  OPTIONAL { ?disease ont:diseaseName ?diseaseName }\n"
        "} GROUP BY ?disease ?diseaseName ORDER BY DESC(?patientCount)\n"
        f"LIMIT {_clamp(slots.get('limit', 10))}"
    )


def top_medications_by_diseases(slots: dict[str, Any]) -> str:
    return (
        "SELECT DISTINCT ?medication ?medicationName (COUNT(DISTINCT ?d) AS ?diseaseCount) WHERE {\n"
        "  ?d ont:hasTreatment / ont:usesMedication ?medication .\n"
        "  OPTIONAL { ?medication ont:medicationName ?medicationName }\n"
        "} GROUP BY ?medication ?medicationName ORDER BY DESC(?diseaseCount)\n"
        f"LIMIT {_clamp(slots.get('limit', 10))}"
    )


def patients_per_doctor(slots: dict[str, Any]) -> str:
    return (
        "SELECT DISTINCT ?doctor ?doctorName (COUNT(DISTINCT ?p) AS ?patientCount) WHERE {\n"
        "  ?doctor a ont:Doctor .\n"
        "  OPTIONAL { ?doctor ont:doctorName ?doctorName }\n"
        "  OPTIONAL { ?p ont:treatedBy ?doctor }\n"
        "} GROUP BY ?doctor ?doctorName ORDER BY DESC(?patientCount)\n"
        f"LIMIT {_clamp(slots.get('limit', 10))}"
    )


# slot name -> ontology property path, used to answer a boolean question
ASK_PATTERNS = {
    "hasDisease": ("patient", "hasDisease", "disease"),
    "treatedBy": ("patient", "treatedBy", "doctor"),
    "hasSymptom": ("disease", "hasSymptom", "symptom"),
    "hasTreatment": ("disease", "hasTreatment", "treatment"),
    "usesMedication": ("treatment", "usesMedication", "medication"),
    "worksIn": ("doctor", "worksIn", "department"),
    "locatedIn": ("department", "locatedIn", "hospital"),
    "undergoesTest": ("patient", "undergoesTest", "test"),
    "hasAppointment": ("patient", "hasAppointment", "appointment"),
    "hasMedication": ("patient", "usesMedication", "medication"),
}


def ask_boolean(slots: dict[str, Any]) -> str:
    key = str(slots.get("ask_predicate") or "hasDisease")
    pattern = ASK_PATTERNS.get(key)
    if pattern is None:
        raise TemplateError(f"Unsupported boolean relation: {key}")
    left, predicate, right = pattern
    _needs(slots, left, right)
    return f"ASK WHERE {{ {iri(slots[left])} ont:{safe_local(predicate)} {iri(slots[right])} }}"


def hospitals_by_type(slots: dict[str, Any]) -> str:
    _needs(slots, "hospital_type")
    return _filtered("h", "Hospital", f"  ?h a {iri(slots['hospital_type'])} .", limit=_clamp(slots.get("limit")))


def departments_by_type(slots: dict[str, Any]) -> str:
    _needs(slots, "department_type")
    return _filtered(
        "d", "MedicalDepartment", f"  ?d a {iri(slots['department_type'])} .", limit=_clamp(slots.get("limit"))
    )


def hospitals_by_department_type(slots: dict[str, Any]) -> str:
    _needs(slots, "department_type")
    return (
        "SELECT DISTINCT ?hospital ?hospitalName WHERE {\n"
        f"  ?department a {iri(slots['department_type'])} ; ont:locatedIn ?hospital .\n"
        "  OPTIONAL { ?hospital ont:hospitalName ?hospitalName }\n"
        f"}}\nLIMIT {_clamp(slots.get('limit'))}"
    )


def doctors_without_patients(slots: dict[str, Any]) -> str:
    return _filtered(
        "d",
        "Doctor",
        "  FILTER NOT EXISTS { ?d ont:treats ?p }",
        limit=_clamp(slots.get("limit")),
    )


TEMPLATES: dict[str, Callable[[dict[str, Any]], str]] = {
    "list_instances": list_instances,
    "count_instances": count_instances,
    "describe_individual": describe_individual,
    "disease_symptoms": disease_symptoms,
    "disease_treatments": disease_treatments,
    "disease_medications": disease_medications,
    "disease_description": disease_description,
    "symptom_diseases": symptom_diseases,
    "disease_patients": disease_patients,
    "patient_diseases": patient_diseases,
    "patient_doctor": patient_doctor,
    "doctor_patients": doctor_patients,
    "doctor_department": doctor_department,
    "doctor_hospital": doctor_hospital,
    "doctors_by_specialty": doctors_by_specialty,
    "department_doctors": department_doctors,
    "department_hospital": department_hospital,
    "hospital_departments": hospital_departments,
    "hospital_doctors": hospital_doctors,
    "followed_in_hospital": followed_in_hospital,
    "patient_tests": patient_tests,
    "tests_by_type": tests_by_type,
    "tests_by_result": tests_by_result,
    "patient_appointments": patient_appointments,
    "appointments_by_status": appointments_by_status,
    "appointments_by_department": appointments_by_department,
    "appointments_by_type": appointments_by_type,
    "appointments_by_date": appointments_by_date,
    "upcoming_appointments": upcoming_appointments,
    "emergency_patients": emergency_patients,
    "chronic_patients": chronic_patients,
    "patients_by_age_group": patients_by_age_group,
    "patients_by_age_comparator": patients_by_age_comparator,
    "patients_by_blood_type": patients_by_blood_type,
    "patients_by_gender": patients_by_gender,
    "medication_dosage": medication_dosage,
    "medications_by_class": medications_by_class,
    "treatment_medications": treatment_medications,
    "treatment_duration": treatment_duration,
    "search_by_keyword": search_by_keyword,
    "top_diseases_by_patients": top_diseases_by_patients,
    "top_medications_by_diseases": top_medications_by_diseases,
    "patients_per_doctor": patients_per_doctor,
    "hospitals_by_type": hospitals_by_type,
    "departments_by_type": departments_by_type,
    "hospitals_by_department_type": hospitals_by_department_type,
    "doctors_without_patients": doctors_without_patients,
    "ask_boolean": ask_boolean,
}

LISTABLE = {
    "Patient": "Patient",
    "Doctor": "Doctor",
    "Disease": "Disease",
    "Symptom": "Symptom",
    "Treatment": "Treatment",
    "Medication": "Medication",
    "MedicalTest": "MedicalTest",
    "MedicalAppointment": "MedicalAppointment",
    "Hospital": "Hospital",
    "MedicalDepartment": "MedicalDepartment",
}


def build(intent: str, slots: dict[str, Any]) -> str:
    """Render the template of one intent, prefixes included."""
    template = TEMPLATES.get(intent)
    if template is None:
        raise TemplateError(f"Unknown intent: {intent}")
    return PREFIX_BLOCK + template(slots)
