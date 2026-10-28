"""Startup vocabulary: Fuseki labels + the hand written French lexicon."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .config import DATA_DIR, settings
from .fuseki import VOCABULARY_QUERY, select
from .normalize import normalize

ONT = "http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#"

# literal ranges of the ontology, used for value recognition and for the intent slots
APPOINTMENT_STATUSES = ["Pending", "Confirmed", "Completed", "Cancelled"]
GENDERS = ["Male", "Female"]
BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
SPECIALTIES = ["GeneralPractitioner", "EmergencyPhysician", "Cardiologist", "Dermatologist", "Neurologist"]

# which literal range a value surface belongs to, used by the intent slots
VALUE_TYPE: dict[str, str] = {
    **{local: "AppointmentStatus" for local in APPOINTMENT_STATUSES},
    **{local: "Gender" for local in GENDERS},
    **{local: "BloodType" for local in BLOOD_TYPES},
}

KIND_BY_CLASS = {
    "Patient": "Patient",
    "Doctor": "Doctor",
    "Disease": "Disease",
    "Symptom": "Symptom",
    "Treatment": "Treatment",
    "Medication": "Medication",
    "MedicalTest": "Test",
    "MedicalAppointment": "Appointment",
    "Hospital": "Hospital",
    "MedicalDepartment": "Department",
}

WORD_RE = re.compile(r"[a-z0-9+#-]+")

# an individual whose local name is pure CamelCase can also be typed as one word
CAMEL_RE = re.compile(r"[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+")

# English spellings of the literal ranges, the French ones live in lexicon_fr.json
VALUE_SYNONYMS_EN = {
    "A+": ["a positive", "group a positive"],
    "A-": ["a negative", "group a negative"],
    "B+": ["b positive", "group b positive"],
    "B-": ["b negative", "group b negative"],
    "AB+": ["ab positive", "group ab positive"],
    "AB-": ["ab negative", "group ab negative"],
    "O+": ["o positive", "group o positive"],
    "O-": ["o negative", "group o negative"],
    "Male": ["men", "man"],
    "Female": ["women", "woman"],
    "Pending": ["still pending", "not yet confirmed"],
    "Confirmed": ["already confirmed"],
    "Completed": ["done", "honoured"],
    "Cancelled": ["canceled", "dropped"],
}

# specialty words a question uses instead of the class label ("doctors in cardiology")
CURATED_CLASS_SURFACES = {
    "Cardiologist": ["cardiology", "cardiac"],
    "Dermatologist": ["dermatology"],
    "Neurologist": ["neurology"],
    "GeneralPractitioner": ["general practice", "family doctor", "general medicine"],
    "EmergencyPhysician": ["emergency medicine"],
    "BloodTest": ["blood work", "blood panel"],
    "CTScan": ["ct scan", "cat scan"],
    "MRI": ["mri scan"],
    "MedicalTest": ["laboratory test", "lab test"],
    "ChronicPatient": ["chronic patient"],
    "EmergencyPatient": ["emergency patient"],
    # the ownership types are named by an adjective in a question, not by the class label
    "PublicHospital": ["public", "publicly funded"],
    "PrivateHospital": ["private", "privately funded"],
    "UniversityHospital": ["university", "teaching hospital"],
    # a class is often named by the plain noun of its instances, not by its label
    "MedicalAppointment": ["appointment", "visit"],
    "MedicalTest": ["test", "exam", "screening"],
    "MedicalDepartment": ["department"],
    "Treatment": ["therapy", "care"],
    "ChildPatient": ["child", "kid", "minor"],
    "AdultPatient": ["adult"],
    "ElderlyPatient": ["elderly", "senior"],
    "ChronicPatient": ["chronic"],
}


@dataclass
class Term:
    """One vocabulary entry: a surface form that resolves to one ontology term."""

    surface: str
    lang: str
    kind: str  # class | individual | property | value
    iri: str
    local: str
    type: str  # ontology class of an individual, datatype for a value, "" otherwise
    source: str
    aliases: list[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.local}:{self.lang}"


def _local(iri: str) -> str:
    return iri[len(ONT):] if iri.startswith(ONT) else iri


class Lexicon:
    """All surfaces the recogniser can resolve, plus a fuzzy index over them."""

    def __init__(self) -> None:
        self.terms: list[Term] = []
        self.by_surface: dict[tuple[str, str], list[Term]] = {}
        self.classes: dict[str, str] = {}  # local -> parent local
        self.individuals: dict[str, list[str]] = {}  # class local -> member locals
        self.properties: dict[str, str] = {}  # local -> datatype/object|datatype
        self.loaded_from_store = False
        self.store_error = ""

    def build(self, fr_path: Path | None = None) -> None:
        self.terms, self.by_surface = [], {}
        self.classes, self.individuals, self.properties = {}, {}, {}
        self.loaded_from_store = False
        self.store_error = ""
        try:
            rows = select(VOCABULARY_QUERY)
            self.loaded_from_store = True
        except Exception as err:  # a cold store must not stop the service
            rows, self.store_error = [], str(err)
        self._add_store_rows(rows)
        self._add_french(fr_path or (DATA_DIR / "lexicon_fr.json"))
        self._add_values()

    def _add_store_rows(self, rows: list[dict[str, str]]) -> None:
        grouped: dict[str, dict[str, dict[str, object]]] = {}
        for row in rows:
            iri = row.get("term", "")
            if not iri.startswith(ONT):
                continue
            local = _local(iri)
            entry = grouped.setdefault(local, {"labels": [], "alts": [], "kind": row.get("kind", "term"), "parents": []})
            text = row.get("label", "")
            alt = row.get("alt", "")
            if text and text not in entry["labels"]:
                entry["labels"].append(text)
            if alt and alt not in entry["alts"]:
                entry["alts"].append(alt)
            parent = row.get("parent", "")
            if parent.startswith(ONT):
                pl = _local(parent)
                if pl not in ("NamedIndividual",) and pl not in entry["parents"]:
                    entry["parents"].append(pl)

        for local, entry in grouped.items():
            kind = str(entry["kind"])
            parents = [p for p in entry["parents"] if p != "NamedIndividual"]
            iri = ONT + local
            if kind == "class":
                self.classes[local] = parents[0] if parents else ""
                surface_kind, term_type = "class", ""
            elif kind in ("object", "datatype", "annotation"):
                self.properties[local] = kind
                surface_kind, term_type = "property", ""
            else:
                surface_kind = "individual"
                term_type = next((KIND_BY_CLASS[p] for p in parents if p in KIND_BY_CLASS), "")
                for p in parents:
                    self.individuals.setdefault(p, [])
                    if local not in self.individuals[p]:
                        self.individuals[p].append(local)
            for text in list(entry["labels"]) + list(entry["alts"]):
                surface = normalize(text)
                if not surface:
                    continue
                self._register(
                    Term(
                        surface=surface,
                        lang="en",
                        kind=surface_kind,
                        iri=iri,
                        local=local,
                        type=term_type,
                        source="fuseki",
                        aliases=[text],
                    )
                )
            # "PneumoniaTreatment" typed without a space is a real user behaviour
            if surface_kind == "individual" and CAMEL_RE.fullmatch(local):
                self._register(
                    Term(local.lower(), "en", "individual", iri, local, term_type, "curated", [local])
                )

    def _add_french(self, path: Path) -> None:
        if not path.exists():
            return
        data = json.loads(path.read_text(encoding="utf-8"))
        sections = {
            "classes": ("class", ONT, ""),
            "individuals": ("individual", ONT, None),
            "properties": ("property", ONT, ""),
            "values": ("value", "", "auto"),
        }
        for section, (kind, _prefix, _t) in sections.items():
            for local, surfaces in (data.get(section) or {}).items():
                iri = ONT + local if _prefix else ""
                term_type = ""
                if kind == "individual":
                    parents = [p for p, members in self.individuals.items() if local in members]
                    term_type = next((KIND_BY_CLASS[p] for p in parents if p in KIND_BY_CLASS), "")
                elif kind == "value":
                    term_type = VALUE_TYPE.get(local, "")
                for text in surfaces:
                    self._register(
                        Term(
                            surface=normalize(text),
                            lang="fr",
                            kind=kind,
                            iri=iri,
                            local=local,
                            type=term_type,
                            source="lexicon_fr",
                            aliases=[text],
                        )
                    )

    def _add_values(self) -> None:
        for local, surfaces in CURATED_CLASS_SURFACES.items():
            for text in surfaces:
                self._register(Term(normalize(text), "en", "class", ONT + local, local, "", "curated"))
        for local in APPOINTMENT_STATUSES:
            self._register(Term(normalize(local), "en", "value", "", local, "AppointmentStatus", "ontology"))
        for local in GENDERS:
            self._register(Term(normalize(local), "en", "value", "", local, "Gender", "ontology"))
        for local in BLOOD_TYPES:
            self._register(Term(normalize(local), "en", "value", "", local, "BloodType", "ontology"))
        for local, surfaces in VALUE_SYNONYMS_EN.items():
            for text in surfaces:
                self._register(Term(normalize(text), "en", "value", "", local, VALUE_TYPE.get(local, ""), "curated"))
        for local in SPECIALTIES:
            self._register(Term(normalize(local), "en", "class", ONT + local, local, "", "ontology"))

    def _register(self, term: Term) -> None:
        if not term.surface:
            return
        existing = self.by_surface.get((term.surface, term.lang))
        if existing and any(t.local == term.local and t.kind == term.kind for t in existing):
            return
        self.terms.append(term)
        self.by_surface.setdefault((term.surface, term.lang), []).append(term)

    def surfaces(self, lang: str | None = None) -> list[str]:
        if lang is None:
            return [t.surface for t in self.terms]
        return [t.surface for t in self.terms if t.lang == lang]

    def lookup(self, surface: str, lang: str | None = None) -> list[Term]:
        """Terms for one surface, the question language first, the other one after.

        A French question may name an English individual and the reverse, so both
        vocabularies are always searched.
        """
        surface = normalize(surface)
        order = ["fr", "en"] if lang == "fr" else ["en", "fr"]
        out: list[Term] = []
        for code in order:
            for term in self.by_surface.get((surface, code), []):
                if not any(t.local == term.local and t.kind == term.kind for t in out):
                    out.append(term)
        return out

    def resolve(self, local: str, kind: str = "individual") -> Term | None:
        for term in self.terms:
            if term.local == local and term.kind == kind and term.lang == "en":
                return term
        return None

    def stats(self) -> dict[str, int]:
        return {
            "terms": len(self.terms),
            "classes": len({t.local for t in self.terms if t.kind == "class"}),
            "properties": len({t.local for t in self.terms if t.kind == "property"}),
            "individuals": len({t.local for t in self.terms if t.kind == "individual"}),
            "values": len({t.local for t in self.terms if t.kind == "value"}),
        }


def words_of(text: str) -> list[str]:
    return WORD_RE.findall(normalize(text))


lexicon = Lexicon()
