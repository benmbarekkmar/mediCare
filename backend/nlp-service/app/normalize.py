"""Text normalisation and language detection: step 1 of the pipeline."""

from __future__ import annotations

import re
import unicodedata

from langdetect import DetectorFactory, LangDetectException, detect

# a fixed seed keeps the detection of short ambiguous questions reproducible
DetectorFactory.seed = 0

WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "dozen": 12,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100,
    "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5, "six": 6, "sept": 7,
    "huit": 8, "neuf": 9, "dix": 10, "onze": 11, "douze": 12, "vingt": 20, "trente": 30,
    "quarante": 40, "cinquante": 50, "soixante": 60, "cent": 100,
}

STOPWORDS = {
    "en": {
        "a", "an", "are", "as", "at", "be", "been", "being", "but", "by", "can", "could", "did",
        "do", "does", "for", "from", "had", "has", "have", "he", "her", "him", "his", "how", "i",
        "in", "is", "it", "its", "me", "might", "must", "my", "of", "on", "or", "our", "she",
        "should", "so", "some", "than", "that", "the", "their", "them", "then", "there", "these",
        "they", "this", "those", "to", "was", "we", "were", "what", "when", "where", "which",
        "who", "whom", "why", "will", "with", "would", "you", "your",
    },
    "fr": {
        "a", "au", "aux", "avec", "ce", "ces", "dans", "de", "des", "du", "elle", "en", "et",
        "eux", "il", "je", "la", "le", "les", "leur", "lui", "ma", "mais", "me", "mes", "mon",
        "ne", "nos", "notre", "nous", "on", "ou", "par", "pas", "pour", "qu", "que", "qui",
        "sa", "se", "ses", "son", "sur", "ta", "te", "tes", "ton", "tu", "un", "une", "vos",
        "votre", "vous", "y", "et", "est", "sont", "a-t-elle", "quels", "quelles",
    },
}

PUNCT = re.compile(r"[?!,;:()\"'\[\]{}.،؛؟]+")
# a curly apostrophe is the one character the NFD pass turns into a control code, and the
# rest of the general punctuation block is a word separator, never part of a name
GENERAL_PUNCT = re.compile(r"[\u00a0\u00ad\u2000-\u206f]+")
WS = re.compile(r"\s+")


def strip_accents(value: str) -> str:
    """`grippe`/`hôpital` -> `hopital`: accents never carry meaning for matching."""
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def normalize(value: str) -> str:
    """Lower case, accent free, punctuation free, single spaced text."""
    lowered = PUNCT.sub(" ", GENERAL_PUNCT.sub(" ", value.lower()))
    return WS.sub(" ", strip_accents(lowered)).strip()


def content_tokens(value: str, lang: str = "en") -> list[str]:
    """Normalized tokens with the stopwords of both supported languages removed."""
    stop = STOPWORDS["en"] | STOPWORDS["fr"]
    return [t for t in normalize(value).split(" ") if t and t not in stop]


ARABIC_SCRIPT = re.compile(r"[\u0600-\u06ff]")
DERJA_CUES = {"chneya", "chnoua", "chnouma", "a3radh", "3andi", "maradh", "tbib", "mawa3id"}
ARABIC_TO_FRENCH = {
    "ما هي": "quels sont", "ما هو": "quel est", "شنية": "quels sont",
    "شنوما": "quels sont", "شنو": "quel", "اعراض": "symptomes",
    "الاعراض": "symptomes", "مرض": "maladie", "السكري": "diabetes",
    "الربو": "asthma", "علاج": "traitement", "علاجات": "traitements",
    "دواء": "medicament", "ادوية": "medicaments", "مواعيد": "rendez vous",
    "موعد": "rendez vous", "طبيب": "medecin", "اطباء": "medecins",
    "تحاليل": "tests", "فحوصات": "examens", "مستشفى": "hopital",
}
DERJA_TO_FRENCH = {
    "chneya": "quels", "chnoua": "quel", "chnouma": "quels",
    "a3radh": "symptomes", "maradh": "maladie", "sokkari": "diabetes",
    "dawa": "medicament", "dwe": "medicaments", "3ilej": "traitement",
    "tbib": "medecin", "mawa3id": "rendez vous",
}


def detect_language(question: str, forced: str | None = None) -> str:
    """Detect French, English, Arabic script, or common Tunisian Derja wording."""
    if forced in ("en", "fr", "ar", "tn"):
        return forced
    if ARABIC_SCRIPT.search(question):
        return "ar"
    words = set(normalize(question).split())
    if words & DERJA_CUES:
        return "tn"
    try:
        return "fr" if detect(question) == "fr" else "en"
    except LangDetectException:
        return "en"


def to_model_language(question: str, lang: str) -> str:
    """Map common Arabic/Derja medical wording to French lexicon terms locally."""
    if lang not in ("ar", "tn"):
        return question
    text = normalize(question)
    mapping = ARABIC_TO_FRENCH if lang == "ar" else DERJA_TO_FRENCH
    for source, target in sorted(mapping.items(), key=lambda pair: len(pair[0]), reverse=True):
        text = re.sub(r"(?<!\w)" + re.escape(source) + r"(?!\w)", target, text)
    return text


def tokenize(text: str) -> list[str]:
    return normalize(text).split(" ")
