"""Intent registry: cue group rules, required slots and per-intent metadata.

A rule is a set of cue groups. Every group must appear somewhere in the question
and the order of the groups does not matter, so "which hospital hosts the
neurology department" and "the neurology department is in which hospital" hit the
same rule. Which ontology individual the question resolved to decides between the
sibling rules (needs / forbids), not the word order.
"""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field
from typing import Any

from .lexicon import KIND_BY_CLASS, Lexicon, Term
from .normalize import normalize

SPECIALTY_CLASSES = {"GeneralPractitioner", "EmergencyPhysician", "Cardiologist", "Dermatologist", "Neurologist"}
TEST_TYPE_CLASSES = {"BloodTest", "UrineTest", "XRay", "MRI", "CTScan"}
MEDICATION_CLASSES = {"Antibiotic", "Analgesic", "Antiviral", "Antihypertensive", "Antidiabetic"}
APPOINTMENT_TYPES = {"Consultation", "FollowUpAppointment", "EmergencyAppointment"}
HOSPITAL_TYPES = {"PublicHospital", "PrivateHospital", "UniversityHospital"}
DEPARTMENT_TYPES = {
    "CardiologyDepartment",
    "DermatologyDepartment",
    "NeurologyDepartment",
    "EmergencyDepartment",
    "GeneralMedicineDepartment",
}
AGE_CLASSES = {"ChildPatient", "AdultPatient", "ElderlyPatient"}
ROOT_CLASSES = {
    "Patient",
    "Doctor",
    "Disease",
    "Symptom",
    "Treatment",
    "Medication",
    "MedicalTest",
    "MedicalAppointment",
    "Hospital",
    "MedicalDepartment",
}

INDIVIDUAL_SLOT = {
    "Patient": "patient",
    "Doctor": "doctor",
    "Disease": "disease",
    "Symptom": "symptom",
    "Treatment": "treatment",
    "Medication": "medication",
    "Test": "test",
    "Department": "department",
    "Hospital": "hospital",
    "Appointment": "appointment",
}
VALUE_SLOT = {"AppointmentStatus": "status", "Gender": "gender", "BloodType": "blood_type"}

# (subject slot, property, object slot) pairs the boolean template can answer
ASK_RELATIONS = [
    ("patient", "hasDisease", "disease"),
    ("patient", "treatedBy", "doctor"),
    ("disease", "hasSymptom", "symptom"),
    ("disease", "hasTreatment", "treatment"),
    ("treatment", "usesMedication", "medication"),
    ("doctor", "worksIn", "department"),
    ("department", "locatedIn", "hospital"),
    ("patient", "undergoesTest", "test"),
]


@dataclass
class Intent:
    name: str
    cue_groups: list[list[str]]
    needs: list[str] = field(default_factory=list)
    forbids: list[str] = field(default_factory=list)
    # worded veto: a question that names another subject must not be read as this intent
    not_cues: list[str] = field(default_factory=list)
    roles: tuple[str, ...] = ("ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT")
    priority: int = 0
    explanation: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._compiled = [re.compile(p) for p in self.patterns()]
        self._vetoed = [re.compile(p) for p in self.not_cues]

    def patterns(self) -> list[str]:
        out: list[str] = []
        for combo in itertools.islice(itertools.product(*self.cue_groups), 96):
            out.append("^(?:" + "".join(f"(?=.*(?:{alt}))" for alt in combo) + ").*$")
        return out

    def match(self, text: str) -> bool:
        if any(p.search(text) for p in self._vetoed):
            return False
        return any(p.search(text) for p in self._compiled)


def _i(
    name: str,
    cue_groups: list[list[str]],
    needs: list[str] | None = None,
    *,
    forbids: list[str] | None = None,
    not_cues: list[str] | None = None,
    roles: tuple[str, ...] = ("ADMIN", "DOCTOR", "RECEPTIONIST", "PATIENT"),
    priority: int = 0,
    explanation: dict[str, str] | None = None,
) -> Intent:
    return Intent(name, cue_groups, needs or [], forbids or [], not_cues or [], roles, priority, explanation or {})


YES_NO = [r"^(does|do|is|are|has|have|will|can|could)\b", r"^(est ce que|est-ce que|y a t il|a t il)\b"]
ANY = [r".*"]

INTENTS: list[Intent] = [
    _i(
        "ask_boolean",
        [YES_NO, [r"(suffer|diagnos|have|has|take|work|belong|treat|treatment|traitement|cause|causes|link|relation|souffr|diagnosti|prend|travaille|suivi|provoque|entraine)"]],
        ["ask_predicate"],
        priority=12,
        explanation={"en": "Checks whether one relationship holds between two individuals.", "fr": "Verifie si une relation existe entre deux individus."},
    ),
    _i(
        "medication_dosage",
        [ANY, [r"(dosage|posology|dose|how much|posologie|combien)"]],
        ["medication"],
        priority=12,
        explanation={"en": "Returns the documented dosage of one medication.", "fr": "Renvoie la posologie d un medicament."},
    ),
    _i(
        "treatment_duration",
        [ANY, [r"(duration|how long|how many days|for how many|last|length|duree|combien de temps|jusqu)"]],
        ["treatment"],
        priority=12,
        explanation={"en": "Returns the documented duration of one treatment.", "fr": "Renvoie la duree d un traitement."},
    ),
    _i(
        "patient_doctor",
        [ANY, [r"(doctor|physician|practitioner|medecin|praticien|docteur|generalist|generaliste|follows|follow|traitant|pris en charge|prend en charge|suivi)"]],
        ["patient"],
        forbids=["doctor"],
        priority=12,
        explanation={"en": "Returns the doctor in charge of one patient.", "fr": "Renvoie le medecin qui suit un patient."},
    ),
    _i(
        "doctor_patients",
        [ANY, [r"(patient|patients|person|people|malade|suivi|suit|cas)" ]],
        ["doctor"],
        forbids=["patient"],
        priority=12,
        explanation={"en": "Lists the patients followed by one doctor.", "fr": "Enumere les patients suivis par un medecin."},
    ),
    _i(
        "doctor_hospital",
        [ANY, [r"(hospital|clinic|establishment|hopital|hopitaux|clinique|etablissement)"]],
        ["doctor"],
        forbids=["department", "department_type"],
        priority=11,
        explanation={"en": "Returns the hospital that employs one doctor.", "fr": "Renvoie l hopital ou travaille un medecin."},
    ),
    _i(
        "doctor_department",
        [ANY, [r"(department|service|unit|departement|unite)"]],
        ["doctor"],
        priority=11,
        explanation={"en": "Returns the department where one doctor works.", "fr": "Renvoie le service d un medecin."},
    ),
    _i(
        "department_hospital",
        [ANY, [r"(hospital|clinic|hopital|hopitaux|clinique|etablissement|establishment|where|ou|situated|located|situe|heberge|hosts|contains|contient|trouve)"]],
        ["department"],
        forbids=["doctor", "patient"],
        priority=12,
        explanation={"en": "Returns the hospital that hosts one department.", "fr": "Renvoie l hopital qui heberge un service."},
    ),
    _i(
        "department_doctors",
        [ANY, [r"(doctor|doctors|physician|staff|medecin|medecins|praticien|docteur|personnel)"]],
        ["department|department_type"],
        priority=12,
        explanation={"en": "Lists the doctors working in one department.", "fr": "Enumere les medecins d un service."},
    ),
    _i(
        "hospital_departments",
        [ANY, [r"(department|departments|service|services|unit|departement|unite)"]],
        ["hospital"],
        forbids=["department", "department_type"],
        priority=12,
        explanation={"en": "Lists the departments of one hospital.", "fr": "Enumere les services d un hopital."},
    ),
    _i(
        "hospital_doctors",
        [ANY, [r"(doctor|doctors|physician|staff|medecin|medecins|praticien|docteur)"]],
        ["hospital"],
        forbids=["department", "department_type"],
        priority=11,
        explanation={"en": "Lists the doctors working in one hospital.", "fr": "Enumere les medecins d un hopital."},
    ),
    _i(
        "followed_in_hospital",
        [ANY, [r"(patient|patients|person|people|malade|atteint|patient)" ]],
        ["hospital"],
        priority=11,
        explanation={"en": "Lists the patients followed in one hospital through the property chain.", "fr": "Enumere les patients suivis dans un hopital via la chaine de proprietes."},
    ),
    _i(
        "disease_medications",
        [ANY, [r"(medication|medications|drug|drugs|prescribe|pill|pills|medicament|medicaments|drogue|comprime|que prendre)"]],
        ["disease"],
        forbids=["treatment"],
        priority=13,
        explanation={"en": "Lists the medications used by the treatments of one disease.", "fr": "Enumere les medicaments utilises par les traitements d une maladie."},
    ),
    _i(
        "treatment_medications",
        [ANY, [r"(medication|medications|drug|drugs|medicament|medicaments|drogue|comprime|contain|contient|compose)"]],
        ["treatment"],
        priority=13,
        explanation={"en": "Lists the medications included in one treatment.", "fr": "Enumere les medicaments d un traitement."},
    ),
    _i(
        "disease_treatments",
        [ANY, [r"(treatment|treatments|therapy|therapies|care|how to treat|traitement|traitements|prise en charge|therapie|soigner)"]],
        ["disease"],
        priority=12,
        explanation={"en": "Lists the treatments declared for one disease.", "fr": "Enumere les traitements declares pour une maladie."},
    ),
    _i(
        "disease_symptoms",
        [ANY, [r"(symptom|symptoms|sign|signs|manifest|manifeste|symptome|symptomes|signe)"]],
        ["disease"],
        forbids=["symptom"],
        priority=12,
        explanation={"en": "Lists the symptoms declared for one disease.", "fr": "Enumere les symptomes declares pour une maladie."},
    ),
    _i(
        "symptom_diseases",
        [ANY, [r"(disease|diseases|condition|conditions|illness|pathologie|maladie|maladies|affection)"]],
        ["symptom"],
        priority=12,
        explanation={"en": "Finds the diseases that declare one symptom.", "fr": "Cherche les maladies qui declarent un symptome donne."},
    ),
    _i(
        "disease_patients",
        [ANY, [r"(patient|patients|person|people|malade|atteint|affected|affecte|souffrant|personne|who)"]],
        ["disease"],
        forbids=["doctor"],
        priority=11,
        explanation={"en": "Lists the patients diagnosed with one disease.", "fr": "Enumere les patients diagnostiques avec une maladie."},
    ),
    _i(
        "patient_diseases",
        [ANY, [r"(disease|diseases|condition|illness|pathologie|maladie|maladies|affection|diagnos|souffre|de quoi)"]],
        ["patient"],
        priority=11,
        explanation={"en": "Lists the diseases recorded for one patient.", "fr": "Enumere les maladies d un patient."},
    ),
    _i(
        "patient_tests",
        [ANY, [r"(test|tests|analysis|analyses|exam|exams|investigation|analyse|analyses|examen|examens)"]],
        ["patient"],
        priority=11,
        explanation={"en": "Lists the medical tests one patient underwent.", "fr": "Enumere les examens passes par un patient."},
    ),
    _i(
        "patient_appointments",
        [ANY, [r"(appointment|appointments|visit|visits|rendez vous|rendezvous|consultation|consultations)"]],
        ["patient"],
        priority=11,
        explanation={"en": "Lists the appointments of one patient.", "fr": "Enumere les rendez-vous d un patient."},
    ),
    _i(
        "tests_by_result",
        [ANY, [r"(result|positive|negative|normal|abnormal|showing|conclusion|resultat|positif|negatif|normal)"]],
        ["result"],
        priority=12,
        explanation={"en": "Searches tests by the wording of their result.", "fr": "Cherche les examens selon le libelle de leur resultat."},
    ),
    _i(
        "tests_by_type",
        [ANY, [r"(test|tests|analysis|analyses|exam|exams|analyse|analyses|examen|examens|irm|radiograph|scanner|tomodensi)"]],
        ["test_type"],
        priority=11,
        explanation={"en": "Lists the medical tests of one type.", "fr": "Enumere les examens d un type donne."},
    ),
    _i(
        "doctors_by_specialty",
        [ANY, [r"(doctor|doctors|physician|physicians|practitioner|practitioners|specialist|specialists|medecin|medecins|praticien|specialiste|cardiolog|dermatolog|neurolog|general practition|emergency physic|urgentiste)"]],
        ["specialty"],
        not_cues=[r"(department|departments|service|services|departement|unite|hopital|hopitaux|clinique)"],
        priority=12,
        explanation={"en": "Lists the doctors of one medical specialty.", "fr": "Enumere les medecins d une specialite."},
    ),
    _i(
        "medications_by_class",
        [ANY, [r"(medication|medications|drug|drugs|medicament|medicaments|antibiotic|antibiotique|analgesic|antalgique|antiviral|antihypertensive|antihypertenseur|antidiabetic|antidiabetique)"]],
        ["medication_class"],
        priority=12,
        explanation={"en": "Lists the medications of one pharmacological class.", "fr": "Enumere les medicaments d une classe pharmacologique."},
    ),
    _i(
        "hospitals_by_type",
        [ANY, [r"(hospital|hospitals|clinic|clinics|hopital|hopitaux|clinique)"]],
        ["hospital_type"],
        not_cues=[r"(appointment|rendez vous|consultation|doctor|medecin|docteur|patient|malade)"],
        priority=11,
        explanation={"en": "Lists the hospitals of one ownership type.", "fr": "Enumere les hopitaux d un type donne."},
    ),
    _i(
        "departments_by_type",
        [ANY, [r"(department|departments|service|services|departement|unite)"]],
        ["department_type"],
        forbids=["hospital", "doctor", "patient"],
        not_cues=[r"(appointment|rendez vous|consultation)"],
        priority=11,
        explanation={"en": "Lists the departments of one specialty type.", "fr": "Enumere les services d un type de specialite."},
    ),
    _i(
        "hospitals_by_department_type",
        [ANY, [r"(hospital|hospitals|clinic|clinics|hopital|hopitaux|clinique|etablissement|establishment)"]],
        ["department_type"],
        forbids=["hospital", "department"],
        priority=12,
        explanation={"en": "Lists the hospitals that have one kind of department.", "fr": "Enumere les hopitaux disposant d un type de service."},
    ),
    _i(
        "appointments_by_department",
        [ANY, [r"(appointment|appointments|rendez vous|consultation|consultations)"]],
        ["department|department_type"],
        priority=11,
        explanation={"en": "Lists the appointments booked in one department.", "fr": "Enumere les rendez-vous d un service."},
    ),
    _i(
        "appointments_by_status",
        [ANY, [r"(pending|attente|confirmed|completed|cancelled|attends|confirme|termine|annule|status|state|statut|etat)"]],
        ["status"],
        priority=11,
        explanation={"en": "Lists the appointments that carry one status.", "fr": "Enumere les rendez-vous ayant un statut donne."},
    ),
    _i(
        "appointments_by_type",
        [ANY, [r"(appointment|appointments|rendez vous|consultation)"]],
        ["appointment_type"],
        priority=11,
        explanation={"en": "Lists the appointments of one appointment type.", "fr": "Enumere les rendez-vous d un type."},
    ),
    _i(
        "upcoming_appointments",
        [ANY, [r"(upcoming|next|future|later|scheduled|prochain|a venir|futur|prevu|today|ce jour)"]],
        [],
        forbids=["patient", "department", "department_type", "status", "appointment_type", "date"],
        priority=10,
        explanation={"en": "Lists the appointments scheduled from now on.", "fr": "Enumere les rendez-vous prevus a partir de maintenant."},
    ),
    _i(
        "appointments_by_date",
        [ANY, [r"(appointment|appointments|rendez vous|consultation|consultations|\d{4}-\d{2})"]],
        ["date"],
        priority=9,
        explanation={"en": "Restricts the appointments to a date or a date range.", "fr": "Restreint les rendez-vous a une date ou une periode."},
    ),
    _i(
        "patients_by_age_comparator",
        [ANY, [r"(older|younger|aged|over|under|between|less than|more than|plus de|moins de|superieur|inferieur|entre|ans|years)"]],
        ["age_operator"],
        priority=12,
        explanation={"en": "Filters patients on their age with a comparator.", "fr": "Filtre les patients selon leur age avec un operateur."},
    ),
    _i(
        "patients_by_age_group",
        [ANY, [r"(child|children|kid|adult|adults|elderly|senior|agee|agees|enfant|adulte|personne agee|age group)" ]],
        ["age_group"],
        priority=12,
        explanation={"en": "Lists the patients of one derived age class.", "fr": "Enumere les patients d une classe d age derivee."},
    ),
    _i(
        "patients_by_blood_type",
        [ANY, [r"(blood|groupe|group|sang)" ]],
        ["blood_type"],
        priority=12,
        explanation={"en": "Lists the patients of one blood type.", "fr": "Enumere les patients d un groupe sanguin."},
    ),
    _i(
        "patients_by_gender",
        [ANY, [r"(male|female|men|women|gender|sex|homme|femme|genre|sexe)" ]],
        ["gender"],
        priority=11,
        explanation={"en": "Lists the patients of one gender.", "fr": "Enumere les patients d un sexe donne."},
    ),
    _i(
        "emergency_patients",
        [ANY, [r"(emergency|emergencies|urgence|urgences|releve|triage)" ]],
        [],
        forbids=["appointment", "appointments", "department", "department_type"],
        priority=10,
        explanation={"en": "Lists the patients flagged as emergency cases.", "fr": "Enumere les patients classes en urgence."},
    ),
    _i(
        "chronic_patients",
        [ANY, [r"(chronic|long term|chronique|longue duree)" ]],
        [],
        priority=10,
        explanation={"en": "Lists the patients with a chronic disease.", "fr": "Enumere les patients atteints d une maladie chronique."},
    ),
    _i(
        "top_diseases_by_patients",
        [ANY, [r"(most common|top|frequent|rank|ranked|most|les plus|frequente|courante|frequence|classement|par nombre)" ]],
        ["class_disease"],
        not_cues=[r"(medication|medications|drug|drugs|medicament|medicaments)"],
        priority=13,
        explanation={"en": "Ranks the diseases by the number of patients carrying them.", "fr": "Classe les maladies par nombre de patients."},
    ),
    _i(
        "top_medications_by_diseases",
        [ANY, [r"(most used|most prescribed|most|top|frequently|le plus de maladies|les plus prescrit|les plus utilise)" ]],
        ["class_medication"],
        priority=13,
        explanation={"en": "Ranks the medications by the number of diseases they treat.", "fr": "Classe les medicaments par nombre de maladies traitees."},
    ),
    _i(
        "patients_per_doctor",
        [ANY, [r"(workload|how many patients|combien de patients|patients per|per doctor|par medecin|caseload|charge|patient count|nb patients)" ]],
        ["class_doctor|doctor"],
        priority=13,
        explanation={"en": "Counts the patients of each doctor.", "fr": "Compte les patients de chaque medecin."},
    ),
    _i(
        "doctors_without_patients",
        [ANY, [r"(no patients|without patients|unassigned|idle|aucun patient|sans patient)" ]],
        [],
        priority=13,
        explanation={"en": "Lists the doctors that currently follow no patient.", "fr": "Enumere les medecins sans patient."},
    ),
    _i(
        "describe_individual",
        [ANY, [r"(describe|decrire|decrit|details|detail|profile|information|record|everything|know about|decris|fiche|dossier|tout|renseignements)" ]],
        ["individual"],
        priority=10,
        explanation={"en": "Dumps every asserted property of one individual.", "fr": "Affiche toutes les proprietes assertees d un individu."},
    ),
    _i(
        "disease_description",
        [ANY, [r"(description|what is|definition|define|tell me about|qu.?est.?ce|description|parle moi)" ]],
        ["disease"],
        priority=8,
        explanation={"en": "Returns the documented description of one disease.", "fr": "Renvoie la description documentee d une maladie."},
    ),
    _i(
        "search_by_keyword",
        [[r"(search|find|look for|contains|matching|named|called|mention|chercher|trouver|recherche|mentionne|conten|nomme)"]],
        ["keyword"],
        # a search question looks for a word, it does not navigate a known individual
        forbids=["individual"],
        priority=12,
        explanation={"en": "Searches labels and synonyms with CONTAINS.", "fr": "Cherche dans les libelles et synonymes avec CONTAINS."},
    ),
    _i(
        "count_instances",
        [[r"(how many|number of|count|compt|total|combien|nombre de|total)"]],
        ["class"],
        priority=8,
        explanation={"en": "Counts the individuals of one class.", "fr": "Compte les individus d une classe."},
    ),
    _i(
        "list_instances",
        [[r"(list|all|show|every|give me|enumerate|who are|what are|which|quel|lister|montre|liste|tous|toutes)"]],
        ["class"],
        # a listing question never names one individual: when it does, the question is
        # about that individual and the classifier has to decide which relation
        forbids=["individual"],
        priority=4,
        explanation={"en": "Lists the individuals of one class.", "fr": "Enumere les individus d une classe."},
    ),
]

INTENTS_BY_NAME = {intent.name: intent for intent in INTENTS}


def derive_ask_predicate(slots: dict[str, Any]) -> str | None:
    """The boolean relation a yes/no question is about, from the resolved pair."""
    for subject, predicate, obj in ASK_RELATIONS:
        if slots.get(subject) and slots.get(obj):
            return predicate
    return None


class SlotFiller:
    """Turns recognised entities and extracted values into intent slots."""

    def __init__(self, lexicon: Lexicon) -> None:
        self.lexicon = lexicon

    def fill(self, entities: list[Any], values: dict[str, Any], question: str, dep_keyword: str = "") -> dict[str, Any]:
        slots: dict[str, Any] = {}
        for entity in entities:
            term = self._term(entity)
            if term is not None:
                self._apply(term, slots)
        for key, value in values.items():
            if value is not None and key not in slots:
                slots[key] = value
        # an explicit quoted term wins over the one the dependency tree offered
        keyword = _quoted_or_extra(question) or dep_keyword
        if keyword:
            slots.setdefault("keyword", keyword)
        predicate = derive_ask_predicate(slots)
        if predicate:
            slots["ask_predicate"] = predicate
        return slots

    def _term(self, entity: Any) -> Term | None:
        local = getattr(entity, "id", None) or (entity.get("id") if isinstance(entity, dict) else None)
        kind = getattr(entity, "type", None) or (entity.get("type") if isinstance(entity, dict) else None)
        text = normalize(getattr(entity, "text", "") or (entity.get("text") if isinstance(entity, dict) else "") or "")
        candidates = [term for term in self.lexicon.terms if term.local == local and term.kind == kind]
        if not candidates:
            return None
        # the same individual has one term per language, the matched surface decides
        exact = next((t for t in candidates if t.surface == text), None)
        typed = next((t for t in candidates if t.type), None)
        return exact or typed or candidates[0]

    def _apply(self, term: Term, slots: dict[str, Any]) -> None:
        if term.kind == "individual":
            slot = INDIVIDUAL_SLOT.get(term.type)
            if slot:
                slots.setdefault(slot, term.local)
            slots.setdefault("individual", term.local)
            # a treatment or a diet is named after the disease it concerns, so the
            # French surface "traitement de l hypertension" also names hypertension
            for named in self._named_individuals(term):
                nslot = INDIVIDUAL_SLOT.get(named.type)
                if nslot:
                    slots.setdefault(nslot, named.local)
            return
        if term.kind == "class":
            self._apply_class(term.local, slots)
            return
        if term.kind == "property":
            slots.setdefault("property", term.local)
            return
        self._apply_value(term.local, slots)

    def _named_individuals(self, term: Term) -> list[Term]:
        """The other individuals a compound surface spells out word for word."""
        if " " not in term.surface:
            return []
        words = set(term.surface.split(" "))
        out: list[Term] = []
        for other in self.lexicon.terms:
            if other.kind != "individual" or other.local == term.local or other.type == term.type:
                continue
            # a one or two letter name is a substring of far too many compounds
            if len(other.surface) < 5 or " " in other.surface:
                continue
            if set(other.surface.split(" ")) <= words:
                out.append(other)
        return out

    def _apply_class(self, local: str, slots: dict[str, Any]) -> None:
        if local in SPECIALTY_CLASSES:
            slots.setdefault("specialty", local)
        elif local in TEST_TYPE_CLASSES:
            slots.setdefault("test_type", local)
            slots.setdefault("class", "MedicalTest")
        elif local in MEDICATION_CLASSES:
            slots.setdefault("medication_class", local)
            slots.setdefault("class", "Medication")
        elif local in APPOINTMENT_TYPES:
            slots.setdefault("appointment_type", local)
            slots.setdefault("class", "MedicalAppointment")
        elif local in HOSPITAL_TYPES:
            slots.setdefault("hospital_type", local)
            slots.setdefault("class", "Hospital")
        elif local in DEPARTMENT_TYPES:
            slots.setdefault("department_type", local)
            slots.setdefault("class", "MedicalDepartment")
        elif local in AGE_CLASSES:
            slots.setdefault("age_group", local)
            slots.setdefault("class", "Patient")
        elif local in ("ChronicPatient", "EmergencyPatient"):
            slots.setdefault("class", local)
        else:
            # a root class names itself, a sub class names its root
            root = local if local in ROOT_CLASSES else self._root_of(local)
            if root:
                slots.setdefault("class", root)
                slots.setdefault(f"class_{root.lower()}", True)
                members = self.lexicon.individuals.get(local) or []
                # a sub class with exactly one individual denotes that individual:
                # this is how the ontology spells a symptom such as "fever"
                if local != root and len(members) == 1:
                    slot = INDIVIDUAL_SLOT.get(root)
                    if slot:
                        slots.setdefault(slot, members[0])
            return

        # a bare class name must not be confused with the individual it denotes,
        # so the class slots are tracked under their own names
        root = self._root_of(local) or local
        if local in ROOT_CLASSES or (root and root != local):
            slots.setdefault(f"class_{(root or local).lower()}", True)
        if local == "Disease":
            slots.setdefault("class_disease", True)
        if local == "Medication":
            slots.setdefault("class_medication", True)

    def _apply_value(self, local: str, slots: dict[str, Any]) -> None:
        for term in self.lexicon.terms:
            if term.local != local or term.kind != "value":
                continue
            slot = VALUE_SLOT.get(term.type)
            if slot:
                slots.setdefault(slot, local)
                return

    def _root_of(self, local: str) -> str | None:
        parent = self.lexicon.classes.get(local, "")
        seen: set[str] = set()
        while parent and parent not in seen:
            seen.add(parent)
            if parent in ROOT_CLASSES:
                return parent
            parent = self.lexicon.classes.get(parent, "")
        return None


QUOTED = re.compile(r"[\"']([^\"']{2,80})[\"']")


def _quoted_or_extra(question: str) -> str | None:
    """A search keyword is an explicit quoted term, never the whole question."""
    match = QUOTED.search(question)
    if match:
        return match.group(1)
    return None


def _has_slot(slots: dict[str, Any], need: str) -> bool:
    return any(bool(slots.get(part)) for part in need.split("|"))


def rule_candidates(text: str, slots: dict[str, Any]) -> list[tuple[Intent, float]]:
    plain = normalize(text)
    scored: list[tuple[int, int, Intent, float]] = []
    for order, intent in enumerate(INTENTS):
        if not intent.match(plain):
            continue
        if not all(_has_slot(slots, need) for need in intent.needs):
            continue
        if any(slots.get(field_name) for field_name in intent.forbids):
            continue
        confidence = min(0.95, 0.7 + 0.06 * len(intent.needs))
        scored.append((-intent.priority, order, intent, confidence))
    scored.sort(key=lambda item: (item[0], item[1]))
    return [(intent, confidence) for _p, _o, intent, confidence in scored]


def choose_intent(text: str, slots: dict[str, Any]) -> tuple[Intent | None, float]:
    candidates = rule_candidates(text, slots)
    if not candidates:
        return None, 0.0
    return candidates[0]


def allowed_roles(intent_name: str) -> list[str]:
    intent = INTENTS_BY_NAME.get(intent_name)
    return list(intent.roles) if intent else []
