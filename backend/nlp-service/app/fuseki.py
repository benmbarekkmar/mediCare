"""Read-only Fuseki access used to build the vocabulary at startup."""

from __future__ import annotations

from typing import Any

import requests

from .config import settings

PREFIX_BLOCK = """PREFIX ont: <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
"""

VOCABULARY_QUERY = (
    PREFIX_BLOCK
    + """
SELECT ?term ?label ?alt ?kind ?parent WHERE {
  ?term ?p ?label .
  # rdfs:label alone is not enough in this ontology: an individual is mostly
  # named through its own domain predicate (doctorName, hospitalName, ...)
  FILTER(
    ?p IN (rdfs:label, skos:altLabel, ont:hasName, ont:doctorName, ont:diseaseName,
           ont:symptomName, ont:treatmentName, ont:medicationName, ont:hospitalName,
           ont:departmentName, ont:testType, ont:appointmentType)
  )
  FILTER(isLiteral(?label))
  # COALESCE only skips unbound values, an empty IF branch would always win,
  # so the kind ladder has to be nested IFs
  BIND(
    IF(EXISTS { ?term a owl:Class }, "class",
    IF(EXISTS { ?term a owl:ObjectProperty }, "object",
    IF(EXISTS { ?term a owl:DatatypeProperty }, "datatype",
    IF(EXISTS { ?term a owl:AnnotationProperty }, "annotation",
    IF(EXISTS { ?term a owl:NamedIndividual }, "individual", ""))))) AS ?kind
  )
  OPTIONAL { ?term skos:altLabel ?alt }
  # an individual is linked to its class by rdf:type, a class to its parent by rdfs:subClassOf
  OPTIONAL { ?term (rdf:type|rdfs:subClassOf) ?parent FILTER(isIRI(?parent) && ?parent != owl:NamedIndividual) }
  FILTER(STRSTARTS(STR(?term), str(ont:)))
}
LIMIT 20000
"""
)


class FusekiError(RuntimeError):
    pass


def select(query: str) -> list[dict[str, Any]]:
    """Execute a SELECT against the configured dataset and return plain dicts."""
    try:
        res = requests.post(
            settings.sparql_endpoint,
            params={"query": query},
            auth=settings.auth,
            headers={"Accept": "application/sparql-results+json"},
            timeout=settings.timeout_s,
        )
    except requests.RequestException as err:  # network level failure
        raise FusekiError(f"Fuseki is not reachable at {settings.sparql_endpoint}: {err}") from err
    if res.status_code >= 400:
        raise FusekiError(f"Fuseki answered {res.status_code}: {res.text[:300]}")
    bindings = res.json().get("results", {}).get("bindings", [])
    return [
        {key: term["value"] for key, term in row.items() if isinstance(term, dict) and "value" in term}
        for row in bindings
    ]


def ask(query: str) -> bool:
    """Run an ASK query and return its boolean answer."""
    try:
        res = requests.post(
            settings.sparql_endpoint,
            params={"query": query},
            auth=settings.auth,
            headers={"Accept": "application/sparql-results+json"},
            timeout=settings.timeout_s,
        )
    except requests.RequestException as err:
        raise FusekiError(f"Fuseki is not reachable at {settings.sparql_endpoint}: {err}") from err
    if res.status_code >= 400:
        raise FusekiError(f"Fuseki answered {res.status_code}: {res.text[:300]}")
    return bool(res.json().get("boolean"))


def ping() -> dict[str, Any]:
    try:
        rows = select(PREFIX_BLOCK + "SELECT (COUNT(?s) AS ?c) WHERE { ?s ?p ?o } LIMIT 1")
        return {"ok": True, "triples": int(rows[0]["c"]) if rows else 0}
    except FusekiError as err:
        return {"ok": False, "error": str(err)}
