"""Generate the labelled question bank the intent classifier trains on.

Every line of `data/intents.jsonl` is one paraphrase in EN or FR, semicolon
separated fields for readability: {"text", "intent", "lang"}. The bank is
regenerated deterministically, so a reviewer can diff it.

    python scripts/generate_intents.py            # write data/intents.jsonl
    python scripts/generate_intents.py --check    # verify rules pick the label
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import DATA_DIR  # noqa: E402
from app.intents import INTENTS_BY_NAME, Intent, rule_candidates  # noqa: E402
from app.normalize import detect_language, normalize  # noqa: E402

OUTPUT = DATA_DIR / "intents.jsonl"

# One block per intent: "intent name" -> list of (text, language) pairs.
# Language is explicit because langdetect is unreliable on very short sentences.
BANK: dict[str, list[tuple[str, str]]] = {
    "ask_boolean": [
        ("Does Mariam have hypertension?", "en"),
        ("Does Ahmed suffer from diabetes?", "en"),
        ("Is Dr. Ali treated by the cardiology department?", "en"),
        ("Has Karim taken an MRI?", "en"),
        ("Does diabetes cause fatigue?", "en"),
        ("Is HypertensionTreatment using Amlodipine?", "en"),
        ("Est ce que Mariam souffre dhypertension ?", "fr"),
        ("Est ce que Ahmed est suivi par le docteur hatem ?", "fr"),
        ("Est ce que le diabete provoque la fatigue ?", "fr"),
        ("Y a t il un traitement de la grippe qui prend oseltamivir ?", "fr"),
        ("Est ce que la pneumonie a un traitement ?", "fr"),
        ("Does Sara have asthma?", "en"),
    ],
    "medication_dosage": [
        ("Dosage of Metformin", "en"),
        ("What is the dosage of Paracetamol?", "en"),
        ("How much Amlodipine should be taken?", "en"),
        ("Posology of Amoxicillin", "en"),
        ("What dose of Ibuprofen is documented?", "en"),
        ("Quelle est la posologie du metformin ?", "fr"),
        ("Donne moi la posologie de lamoxicilline", "fr"),
        ("Combien de doliprane faut il prendre ?", "fr"),
        ("Quelle dose de paracetamol ?", "fr"),
        ("Posologie recommandee pour ramipril", "fr"),
    ],
    "treatment_duration": [
        ("How long does the DiabetesTreatment last?", "en"),
        ("What is the duration of the InfluenzaTreatment?", "en"),
        ("How many days does the pneumonia treatment take?", "en"),
        ("Treatment duration for appendicitis", "en"),
        ("Combien de temps dure le traitement du diabete ?", "fr"),
        ("Quelle est la duree du traitement de la grippe ?", "fr"),
        ("Duree prevue pour la kinesitherapie respiratoire", "fr"),
        ("Jusqua quand suivre le traitement de lhypertension ?", "fr"),
    ],
    "patient_doctor": [
        ("Who is the doctor of Ahmed?", "en"),
        ("Which doctor treats Mariam?", "en"),
        ("Who follows Sara?", "en"),
        ("What physician is Karim assigned to?", "en"),
        ("Which medecin takes care of Fatma?", "en"),
        ("Qui est le medecin de ahmed ?", "fr"),
        ("Quel docteur suit mariam ?", "fr"),
        ("Qui prend en charge karim ?", "fr"),
        ("Le medecin traitant de sara", "fr"),
        ("Chez quel praticien est hichem ?", "fr"),
    ],
    "doctor_patients": [
        ("Which patients are followed by Dr. Hatem?", "en"),
        ("List the patients of doctor ali", "en"),
        ("How many people does Dr. Nadia treat?", "en"),
        ("Give me the patients attended by rim", "en"),
        ("Quels sont les patients du docteur hatem ?", "fr"),
        ("Liste les malades suivis par dr nadia", "fr"),
        ("Qui est suivi par le docteur sami ?", "fr"),
        ("Les patients du docteur walid", "fr"),
    ],
    "doctor_hospital": [
        ("Which hospital does Dr. Ali work in?", "en"),
        ("What hospital employs Hatem?", "en"),
        ("For which hospital does Rim work?", "en"),
        ("Dans quel hopital travaille le docteur mohamed ?", "fr"),
        ("Le docteur sami exerce dans quel etablissement ?", "fr"),
        ("Hopital du docteur rim", "fr"),
    ],
    "doctor_department": [
        ("Which department does Dr. Salma work in?", "en"),
        ("What service is Hatem assigned to?", "en"),
        ("Le docteur ali travaille dans quel service ?", "fr"),
        ("Service du docteur nadia", "fr"),
        ("Dans quelle unite exerce dr walid ?", "fr"),
    ],
    "department_hospital": [
        ("Which hospital hosts the neurology department?", "en"),
        ("What hospital is the cardiology department in?", "en"),
        ("Where is the emergency department located?", "en"),
        ("Which establishment contains dermatology?", "en"),
        ("Dans quel hopital se trouve le service de neurologie ?", "fr"),
        ("Ou est situe le service de cardiologie ?", "fr"),
        ("Quel hopital heberge les urgences ?", "fr"),
        ("Le service de medecine generale est dans quel etablissement ?", "fr"),
    ],
    "department_doctors": [
        ("Which doctors work in the cardiology department?", "en"),
        ("List the doctors of the neurology service", "en"),
        ("What staff does the emergency department have?", "en"),
        ("Quels medecins travaillent au service de cardiologie ?", "fr"),
        ("Liste les praticiens du service de neurologie", "fr"),
        ("Le personnel medical des urgences", "fr"),
    ],
    "hospital_departments": [
        ("Which departments does Charles Nicolle Hospital have?", "en"),
        ("List the services of La Rabta Hospital", "en"),
        ("What units exist in Clinique Al Amal?", "en"),
        ("Quels sont les services de l hopital charles nicolle ?", "fr"),
        ("Liste les departements de la rabta", "fr"),
        ("Les unites de la clinique al amal", "fr"),
    ],
    "hospital_doctors": [
        ("Which doctors work at La Rabta Hospital?", "en"),
        ("List the physicians of Charles Nicolle", "en"),
        ("Quels medecins exerce a l hopital charles nicolle ?", "fr"),
        ("Les docteurs de la clinique al amal", "fr"),
    ],
    "followed_in_hospital": [
        ("Which patients are followed in Charles Nicolle Hospital?", "en"),
        ("People treated at La Rabta Hospital", "en"),
        ("Show the patients of Clinique Al Amal", "en"),
        ("Quels patients sont suivis a l hopital la rabta ?", "fr"),
        ("Les malades pris en charge a charles nicolle", "fr"),
    ],
    "disease_medications": [
        ("Medications used for hypertension", "en"),
        ("What drugs treat diabetes?", "en"),
        ("Which medication is prescribed for asthma?", "en"),
        ("What pills for influenza?", "en"),
        ("Quels medicaments pour lhypertension ?", "fr"),
        ("Quels médicaments sont prescrits pour le diabete ?", "fr"),
        ("Que prendre en cas d asthme ?", "fr"),
        ("Liste les medicaments utilises contre la grippe", "fr"),
    ],
    "treatment_medications": [
        ("Which medications are in DiabetesTreatment?", "en"),
        ("Drugs used by the HypertensionTreatment", "en"),
        ("What does the PneumoniaTreatment contain?", "en"),
        ("Quels medicaments compose le traitement de la grippe ?", "fr"),
        ("Les drogues utilisees par le traitement du diabete", "fr"),
    ],
    "disease_treatments": [
        ("How to treat diabetes?", "en"),
        ("Which treatments exist for hypertension?", "en"),
        ("What is the therapy for pneumonia?", "en"),
        ("Care options for asthma", "en"),
        ("Quels sont les traitements du diabete ?", "fr"),
        ("Comment soigner lhypertension ?", "fr"),
        ("Prise en charge de la pneumonie", "fr"),
        ("Quelle therapie pour l asthme ?", "fr"),
    ],
    "disease_symptoms": [
        ("Which symptoms does diabetes have?", "en"),
        ("What are the symptoms of hypertension?", "en"),
        ("Symptoms of influenza", "en"),
        ("What does appendicitis manifest as?", "en"),
        ("Signs of asthma", "en"),
        ("Quels sont les symptomes de la grippe ?", "fr"),
        ("Symptomes du diabete", "fr"),
        ("Comment se manifeste lhypertension ?", "fr"),
        ("Quels signes cliniques pour l appendicite ?", "fr"),
    ],
    "symptom_diseases": [
        ("Which diseases cause chest pain?", "en"),
        ("What illness has fever as a symptom?", "en"),
        ("Diseases related to headache", "en"),
        ("Quelles maladies provoquent la fatigue ?", "fr"),
        ("Quel pathologie donne une toux ?", "fr"),
        ("Maladies associees a une eruption cutanee", "fr"),
    ],
    "disease_patients": [
        ("Which patients have diabetes?", "en"),
        ("List the people suffering from hypertension", "en"),
        ("Who is affected by asthma?", "en"),
        ("Quels patients ont un diabete ?", "fr"),
        ("Liste les personnes souffrant dhypertension", "fr"),
        ("Qui est atteint dosthme ?", "fr"),
    ],
    "patient_diseases": [
        ("Which diseases does Ahmed have?", "en"),
        ("What illness affects Mariam?", "en"),
        ("Diagnosis of Karim", "en"),
        ("Quelles maladies pour ahmed ?", "fr"),
        ("De quoi souffre mariam ?", "fr"),
        ("Pathologies connues de karim", "fr"),
    ],
    "patient_tests": [
        ("Which tests did Sara undergo?", "en"),
        ("List the analyses of Ahmed", "en"),
        ("What exams has Fatma done?", "en"),
        ("Quels examens a passe sara ?", "fr"),
        ("Liste les analyses de ahmed", "fr"),
        ("Examens passes par fatma", "fr"),
    ],
    "patient_appointments": [
        ("Which appointments does Youssef have?", "en"),
        ("List the visits of Mariam", "en"),
        ("Appointments booked for Omar", "en"),
        ("Quels rendez vous pour youssef ?", "fr"),
        ("Liste les consultations de mariam", "fr"),
        ("Rendez vous pris par omar", "fr"),
    ],
    "tests_by_result": [
        ("Which tests have a positive result?", "en"),
        ("Show negative test results", "en"),
        ("Blood work with abnormal conclusion", "en"),
        ("Quels examens ont un resultat positif ?", "fr"),
        ("Resultat negatif des analyses", "fr"),
        ("Examens dont la conclusion est normale", "fr"),
    ],
    "tests_by_type": [
        ("List all blood tests", "en"),
        ("Which MRI exams exist?", "en"),
        ("Show the X-Ray tests", "en"),
        ("Analyse de sang effectuees", "fr"),
        ("Liste les irm realisees", "fr"),
        ("Quelles radiographies existent ?", "fr"),
    ],
    "doctors_by_specialty": [
        ("Doctors working in cardiology", "en"),
        ("Which doctors are dermatologists?", "en"),
        ("List the neurologists", "en"),
        ("Are there general practitioners?", "en"),
        ("Medecins travaillant en cardiologie", "fr"),
        ("Quels sont les dermatologues ?", "fr"),
        ("Liste les neurologues", "fr"),
        ("Y a t il des medecins generalistes ?", "fr"),
    ],
    "medications_by_class": [
        ("List the antibiotics", "en"),
        ("Which medications are analgesics?", "en"),
        ("What antivirals exist?", "en"),
        ("Give me the antihypertensive drugs", "en"),
        ("Liste les antibiotiques", "fr"),
        ("Quels sont les antalgiques ?", "fr"),
        ("Medicaments antidiabetiques disponibles", "fr"),
    ],
    "hospitals_by_type": [
        ("Which hospitals are public?", "en"),
        ("List the private hospitals", "en"),
        ("What university hospitals exist?", "en"),
        ("Quels hopitaux sont publics ?", "fr"),
        ("Liste les cliniques privees", "fr"),
    ],
    "departments_by_type": [
        ("List the cardiology departments", "en"),
        ("Which emergency departments exist?", "en"),
        ("Neurology departments available", "en"),
        ("Quels sont les services de cardiologie ?", "fr"),
        ("Liste les services des urgences", "fr"),
    ],
    "hospitals_by_department_type": [
        ("Which hospitals have a cardiology department?", "en"),
        ("List the hospitals with an emergency service", "en"),
        ("What hospitals contain a neurology department?", "en"),
        ("Quels hopitaux ont un service de cardiologie ?", "fr"),
        ("Dans quels hopitaux trouve t on un service des urgences ?", "fr"),
    ],
    "appointments_by_department": [
        ("Appointments in the cardiology department", "en"),
        ("Which consultations are booked in neurology?", "en"),
        ("Rendez vous du service de medecine generale", "fr"),
        ("Consultations prevues aux urgences", "fr"),
    ],
    "appointments_by_status": [
        ("How many appointments are pending?", "en"),
        ("List the confirmed appointments", "en"),
        ("Which visits are cancelled?", "en"),
        ("Appointments with status completed", "en"),
        ("Quels rendez vous sont en attente ?", "fr"),
        ("Liste les consultations confirmees", "fr"),
        ("Rendez vous annules", "fr"),
    ],
    "appointments_by_type": [
        ("List the emergency appointments", "en"),
        ("Which follow up appointments exist?", "en"),
        ("Show simple consultations", "en"),
        ("Quels sont les rendez vous d urgence ?", "fr"),
        ("Liste les consultations de suivi", "fr"),
    ],
    "upcoming_appointments": [
        ("What are the upcoming appointments?", "en"),
        ("List future appointments", "en"),
        ("Which visits are scheduled next?", "en"),
        ("Appointments planned today", "en"),
        ("Quels sont les prochains rendez vous ?", "fr"),
        ("Liste les consultations a venir", "fr"),
        ("Rendez vous prevus aujourdhui", "fr"),
    ],
    "appointments_by_date": [
        ("Appointments after 2026-11-01", "en"),
        ("Which appointments are on 2026-10-15?", "en"),
        ("Appointments between 2026-11-01 and 2026-11-30", "en"),
        ("Visits before 2026-12-01", "en"),
        ("Rendez vous apres le 2026-11-01", "fr"),
        ("Quels rdv le 2026-10-20 ?", "fr"),
        ("Consultations avant 2026-12-01", "fr"),
    ],
    "patients_by_age_comparator": [
        ("List the patients older than 40", "en"),
        ("Patients under 18", "en"),
        ("Which patients are between 20 and 40?", "en"),
        ("Patients aged more than 65", "en"),
        ("Give me patients younger than 30", "en"),
        ("Liste les patients de plus de 40 ans", "fr"),
        ("Patients ages moins de 18 ans", "fr"),
        ("Quels patients ont entre 20 et 40 ans ?", "fr"),
        ("Personnes agées de plus de 65 ans", "fr"),
    ],
    "patients_by_age_group": [
        ("List the child patients", "en"),
        ("Which patients are adults?", "en"),
        ("Show elderly patients", "en"),
        ("How many seniors are followed?", "en"),
        ("Liste les patients enfants", "fr"),
        ("Quels sont les patients adultes ?", "fr"),
        ("Personnes agees suivies", "fr"),
    ],
    "patients_by_blood_type": [
        ("Which patients have blood type O negative?", "en"),
        ("Patients with A positive group", "en"),
        ("Show the patients with blood group AB positive", "en"),
        ("Quels patients sont du groupe A positif ?", "fr"),
        ("Patients du groupe O negatif", "fr"),
    ],
    "patients_by_gender": [
        ("List the female patients", "en"),
        ("Which patients are male?", "en"),
        ("Women followed in the hospital", "en"),
        ("Liste les patientes femmes", "fr"),
        ("Quels patients sont des hommes ?", "fr"),
    ],
    "emergency_patients": [
        ("Which patients are emergency cases?", "en"),
        ("List patients needing emergency care", "en"),
        ("Emergency cases handled", "en"),
        ("Quels patients sont en urgence ?", "fr"),
        ("Liste des urgences relevees", "fr"),
    ],
    "chronic_patients": [
        ("Patients with chronic diseases", "en"),
        ("Which patients are chronic?", "en"),
        ("Long term illness patients", "en"),
        ("Quels patients sont chroniques ?", "fr"),
        ("Patients atteints de maladie chronique", "fr"),
    ],
    "top_diseases_by_patients": [
        ("What are the most common diseases?", "en"),
        ("Top diseases by number of patients", "en"),
        ("Which illnesses are the most frequent?", "en"),
        ("Rank the diseases by patient count", "en"),
        ("Quelles sont les maladies les plus frequentes ?", "fr"),
        ("Classement des pathologies par nombre de patients", "fr"),
    ],
    "top_medications_by_diseases": [
        ("Which medications are the most prescribed?", "en"),
        ("Top medications by number of diseases treated", "en"),
        ("Les medicaments les plus prescrits", "fr"),
        ("Quels medicaments traitent le plus de maladies ?", "fr"),
    ],
    "patients_per_doctor": [
        ("How many patients does each doctor have?", "en"),
        ("Patient count per doctor", "en"),
        ("Workload of every physician", "en"),
        ("Combien de patients par medecin ?", "fr"),
        ("Charge patient de chaque praticien", "fr"),
    ],
    "doctors_without_patients": [
        ("Which doctors have no patients?", "en"),
        ("Doctors without patients", "en"),
        ("Any unassigned physician?", "en"),
        ("Quels medecins n ont aucun patient ?", "fr"),
        ("Praticiens sans patient suivi", "fr"),
    ],
    "describe_individual": [
        ("Describe Dr. Hatem", "en"),
        ("Give me the details of Charles Nicolle Hospital", "en"),
        ("Full record of Metformin", "en"),
        ("What do we know about Diabetes?", "en"),
        ("Profile of the patient Karim", "en"),
        ("Decrire le docteur hatem", "fr"),
        ("Donne moi la fiche de l hopital la rabta", "fr"),
        ("Tout savoir sur le diabete", "fr"),
        ("Dossier complet de metformine", "fr"),
    ],
    "disease_description": [
        ("What is diabetes?", "en"),
        ("Give me the description of hypertension", "en"),
        ("Definition of asthma", "en"),
        ("Tell me about influenza", "en"),
        ("Disease description of pneumonia", "en"),
        ("Quest ce que le diabete ?", "fr"),
        ("Description de la maladie asthme", "fr"),
        ("Parle moi de la grippe", "fr"),
        ("Definition de l appendicite", "fr"),
    ],
    "search_by_keyword": [
        ("Search for entities named \"cardio\"", "en"),
        ("Find individuals containing \"amol\"", "en"),
        ("Look for records matching \"nicolle\"", "en"),
        ("Chercher tout ce qui contient \"rabta\"", "fr"),
        ("Trouver les entites nommees \"pram\"", "fr"),
        ("Recherche le mot \"tamiflu\"", "fr"),
    ],
    "count_instances": [
        ("How many patients are registered?", "en"),
        ("Count the doctors", "en"),
        ("What is the total number of hospitals?", "en"),
        ("How many medications exist?", "en"),
        ("Number of diseases in the ontology", "en"),
        ("Combien de patients inscrits ?", "fr"),
        ("Compte les medecins", "fr"),
        ("Nombre total d hopitaux", "fr"),
        ("Combien de medicaments existent ?", "fr"),
    ],
    "list_instances": [
        ("List all patients", "en"),
        ("Show every hospital", "en"),
        ("Give me the diseases", "en"),
        ("Enumerate the symptoms", "en"),
        ("Which departments exist?", "en"),
        ("Liste tous les patients", "fr"),
        ("Montre tous les hopitaux", "fr"),
        ("Donne moi la liste des maladies", "fr"),
        ("Quels sont les symptomes connus ?", "fr"),
    ],
}


def lines() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for intent, examples in BANK.items():
        if intent not in INTENTS_BY_NAME:
            raise SystemExit(f"Unknown intent in the bank: {intent}")
        for text, lang in examples:
            out.append({"text": text, "intent": intent, "lang": lang})
    return out


def check() -> int:
    """Each labelled text must at least satisfy its own intent cue groups."""
    failures = 0
    for item in lines():
        intent: Intent = INTENTS_BY_NAME[item["intent"]]
        if not intent.match(normalize(item["text"])):
            print(f"[cue] {item['intent']}: {item['text']}")
            failures += 1
        detected = detect_language(item["text"], None)
        if detected != item["lang"] and not item["text"].isascii():
            print(f"[lang] {item['lang']}!={detected}: {item['text']}")
    missing = sorted(set(INTENTS_BY_NAME) - set(BANK))
    if missing:
        print(f"Intents with no examples: {', '.join(missing)}")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify cues without writing")
    args = parser.parse_args()

    if args.check:
        raise SystemExit(1 if check() else 0)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    data = lines()
    payload = "\n".join(json.dumps(item, ensure_ascii=False) for item in data) + "\n"
    OUTPUT.write_text(payload, encoding="utf-8")

    counts = Counter(item["intent"] for item in data)
    languages = Counter(item["lang"] for item in data)
    print(f"{OUTPUT}: {len(data)} examples, {len(counts)} intents, languages={dict(languages)}")
    short = {intent: n for intent, n in counts.items() if n < 4}
    if short:
        print(f"thin coverage: {short}")


if __name__ == "__main__":
    main()
