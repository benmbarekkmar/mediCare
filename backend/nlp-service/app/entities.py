"""Entity recognition and linking: spaCy rules plus RapidFuzz for typos."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

import spacy
from rapidfuzz import fuzz, process
from rapidfuzz.distance import Levenshtein
from spacy.matcher import PhraseMatcher
from spacy.pipeline import EntityRuler

from .config import SPACY_MODELS
from .lexicon import Lexicon, Term, words_of
from .normalize import normalize

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7,
    "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
    "jan": 1, "fev": 2, "avr": 4, "mai": 5, "jun": 6, "jul": 7, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

COMPARATOR_PATTERNS = [
    (re.compile(r"(?:older|aged|more than|over|at least|superior to|older than|plus vieux)\s*(?:than\s+)?(?:aged\s+)?(\d{1,3})"), "gt"),
    (re.compile(r"(?:younger|less than|under|below|at most|moins jeune)\s*(?:than\s+)?(?:aged\s+)?(\d{1,3})"), "lt"),
    (re.compile(r"between\s+(\d{1,3})\s+and\s+(\d{1,3})"), "between"),
    (re.compile(r"(?:plus de|superieur a|au dessus de|au dela de)\s+(\d{1,3})\s*(?:ans)?"), "gt"),
    (re.compile(r"(?:moins de|inferieur a|au dessous de|en dessous de)\s+(\d{1,3})\s*(?:ans)?"), "lt"),
    (re.compile(r"entre\s+(\d{1,3})\s*et\s*(\d{1,3})\s*ans"), "between"),
    (re.compile(r"(?:aged|age of)\s+(\d{1,3})"), "eq"),
    (re.compile(r"(\d{1,3})\s*(?:years old|ans)\b"), "eq"),
]

LIMIT_PATTERNS = [
    re.compile(r"(?:top|first|latest|last)\s+(\d{1,3})"),
    re.compile(r"(\d{1,3})\s+(?:first|latest|last|most)"),
    re.compile(r"(?:les|les \d+|nombre de)\s*(\d{1,3})\s*(?:premiers|dernieres|derniers|max|maximal)"),
    re.compile(r"\b(?:top|maximum|max)\s*(\d{1,3})"),
]

ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
DATE_WITHOUT_DAY = re.compile(r"\b(\d{4})-(\d{2})\b")
# the question text is already lower cased and accent folded here
BLOOD_TYPE = re.compile(r"(?<![a-z0-9])([abo][ab]?)([+-])(?![a-z0-9])")

DATE_AFTER = re.compile(r"\b(after|from|since|later|beyond|starting|apres|comptant|commencant|suivant)\b")
DATE_BEFORE = re.compile(r"\b(before|until|till|ending|avant|jusqu|precedents)\b")

# wording of a test conclusion, used by tests_by_result; "abnormal" is listed before
# "normal" because the word boundary rule alone cannot tell the two apart
RESULT_WORDS = [
    "no abnormality",
    "abnormal",
    "normal",
    "positive",
    "negative",
    "elevated",
    "high glucose",
    "opacity",
    "infection",
    "positif",
    "negatif",
    "eleve",
    "anomalie",
    "opacite",
]


@dataclass
class Entity:
    text: str
    type: str  # class | individual | property | value
    id: str
    iri: str
    label: str
    matched_via: str
    score: float

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def _entity_from(term: Term, text: str, via: str, score: float) -> Entity:
    return Entity(
        text=text,
        type=term.kind,
        id=term.local,
        iri=term.iri,
        label=term.aliases[0] if term.aliases else term.local,
        matched_via=via,
        score=round(score, 3),
    )


KIND_PRIORITY = {"class": 0, "individual": 1, "property": 2, "value": 3}

# the shortest word the pass accepts a single wrong letter in: below that length one
# substitution is a ratio far too low to be a typo and one edit too many to be safe
MIN_TYPO_LENGTH = 7

# the verbs a search question puts its keyword after, in either language
SEARCH_VERBS = {
    "search", "find", "look", "match", "contain", "include", "mention", "call", "name", "begin",
    "chercher", "trouver", "contenir", "comprendre", "mentionner", "appeler", "nommer",
}


def _typo_or_close(candidate: str, surface: str, score: float) -> bool:
    """Whether a fuzzy hit is a typo of the surface or close enough to be one."""
    if score >= 86:
        return True
    return (
        len(candidate) >= MIN_TYPO_LENGTH
        and len(surface) >= MIN_TYPO_LENGTH
        and Levenshtein.distance(candidate, surface) <= 1
    )


class Recognizer:
    """Loads the spaCy pipelines once and reuses them for every question."""

    def __init__(self, lexicon: Lexicon) -> None:
        self.lexicon = lexicon
        self.nlp: dict[str, Any] = {}
        self.rulers: dict[str, EntityRuler] = {}
        self.property_matchers: dict[str, PhraseMatcher] = {}
        self._lemma_cache: dict[str, dict[str, str]] = {}
        for lang, model in SPACY_MODELS.items():
            # the parser stays on: the intent rules use POS tags and dependency relations
            nlp = spacy.load(model, disable=["ner"])
            nlp.max_length = 10_000
            # the ruler runs after the lemmatiser: its LEMMA patterns need the lemma of
            # every token, so it cannot be the first component of the pipeline
            nlp.add_pipe("entity_ruler", config={"overwrite_ents": True})
            self.nlp[lang] = nlp
            ruler = nlp.get_pipe("entity_ruler")
            # both vocabularies are loaded into every pipeline: a French question
            # still names English individuals, and vice versa
            ruler.add_patterns(self._patterns(lang, ("class", "individual", "value")))
            self.rulers[lang] = ruler
            self.property_matchers[lang] = self._matcher(("property",))
        # only a single word surface goes into the fuzzy index: a typo keeps the word
        # count, while a two word span is free to realign onto any unrelated pair.
        # the index is built per model because a typed word is compared with the lemma
        # that model reads, and it is one index per kind of pipeline.
        self._fuzz_terms: dict[str, list[Term]] = {}
        self._fuzz_choices: dict[str, list[str]] = {}
        for model in SPACY_MODELS:
            terms: list[Term] = []
            choices: list[str] = []
            seen: set[tuple[str, str]] = set()
            for term in lexicon.terms:
                # values and properties are only matched exactly: a five letter value
                # surface is a fuzzy match waiting to happen on any long word
                if term.kind not in ("class", "individual") or not term.surface:
                    continue
                if " " in term.surface or len(term.surface) < 4:
                    continue
                for form in self._forms(model, term.surface):
                    key = (form, term.local)
                    if key in seen:
                        continue
                    seen.add(key)
                    terms.append(term)
                    choices.append(form)
            self._fuzz_terms[model] = terms
            self._fuzz_choices[model] = choices

    def _forms(self, model: str, surface: str) -> list[str]:
        """A single word surface and the lemma the model gives it."""
        lemma = self._lemmas(model, (surface,))[0]
        return [surface] if lemma == surface else [surface, lemma]

    def _patterns(self, model: str, kinds: tuple[str, ...]) -> list[dict[str, Any]]:
        patterns: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for term in self.lexicon.terms:
            if kinds and term.kind not in kinds:
                continue
            words = [w for w in term.surface.split(" ") if w]
            if not words:
                continue
            key = (term.surface, term.local)
            if key in seen:
                continue
            seen.add(key)
            # the exact tokens catch the written form, the lemmas catch the plurals
            # and the verb forms the surface of the ontology is not spelled for
            attrs = [("LOWER", words), ("LEMMA", list(self._lemmas(model, tuple(words))))]
            # a lemma only exists per model: the French plural "urgences" lemmatises to
            # "urgence", so its pattern has to be built by the pipeline that reads it
            for attr, token_attrs in attrs:
                patterns.append(
                    {
                        "label": term.kind,
                        "pattern": [{attr: w} for w in token_attrs],
                        "id": term.local,
                        "term": term.surface,
                    }
                )

        # longest surfaces first so "cardiology department" wins over "cardiology".
        # then the most specific class: one surface can name both a root class and one
        # of its sub classes, and only the sub class reading leads to the right intent
        def rank(pattern: dict[str, Any]) -> tuple[int, int, str]:
            specific = 1 if self.lexicon.classes.get(pattern["id"], "") else 0
            return (len(pattern["pattern"]), specific, pattern["term"])

        patterns.sort(key=rank, reverse=True)
        return patterns

    def _lemmas(self, model: str, words: tuple[str, ...]) -> tuple[str, ...]:
        """The lemma of each word of a surface, under the pipeline that reads it."""
        cache = self._lemma_cache.setdefault(model, {})
        missing = [word for word in words if word not in cache]
        if missing:
            nlp = self.nlp[model]
            with nlp.select_pipes(disable=["entity_ruler"]):
                for word, doc in zip(missing, nlp.pipe(missing)):
                    cache[word] = doc[0].lemma_ if len(doc) else word
        return tuple(cache.get(word, word) for word in words)

    def _matcher(self, kinds: tuple[str, ...]) -> PhraseMatcher:
        """A PhraseMatcher over one kind of surfaces, used for the late property pass."""
        vocab = self.nlp["en"].vocab
        matcher = PhraseMatcher(vocab, attr="LOWER")
        nlp_doc = self.nlp["en"]
        seen: set[tuple[str, str]] = set()
        for term in self.lexicon.terms:
            if term.kind not in kinds or not term.surface:
                continue
            key = (term.surface, term.local)
            if key in seen:
                continue
            seen.add(key)
            matcher.add(f"{term.local}|{term.lang}", [nlp_doc.make_doc(term.surface)])
        return matcher

    def recognize(self, question: str, lang: str) -> tuple[list[Entity], list[str], str, str]:
        """Rule based spans, then a fuzzy pass for typos, then the property names.

        The third value is the question with every typo replaced by the vocabulary
        spelling of the term it linked to: a cue list cannot know "sumptoms", but the
        intent of "sumptoms of diabetes" is the intent of "symptoms of diabetes".
        The fourth is the keyword the dependency tree puts in the place of a search
        verb, so an unquoted "find the hospitals that mention Rabta" still searches.
        """
        text = normalize(question)
        doc = self.nlp[lang or "en"](text)
        found: list[Entity] = []
        covered: set[int] = set()
        for ent in doc.ents:
            terms = self.lexicon.lookup(ent.text, lang)
            term = next((t for t in terms if t.local == ent.ent_id_ and t.kind == ent.label_), None)
            if term is None:
                # a LEMMA pattern can match a span the vocabulary is not spelled for,
                # such as "blood tests" for the surface "blood test": the ruler knows
                # which term it matched, so the term is resolved by identity
                term = self._by_identity(ent.ent_id_, ent.label_, lang) or (terms[0] if terms else None)
            if term is None:
                continue
            found.append(_entity_from(term, ent.text, "spacy-entity-ruler", 1.0))
            covered.update(range(ent.start_char, ent.end_char))
        blocked = _span_indices(doc, covered)
        fuzzy, fuzzy_tokens, rewrites = self._fuzzy_pass(doc, blocked, lang)
        found.extend(fuzzy)
        blocked.update(fuzzy_tokens)
        properties = self._property_pass(doc, blocked, lang)
        found.extend(properties)
        lemmas = [token.lemma_ for token in doc]
        canonical = " ".join(rewrites.get(index, token.text) for index, token in enumerate(doc))
        return found, lemmas, canonical, self._search_focus(doc, lang)

    def _search_focus(self, doc: Any, lang: str) -> str:
        """The direct object of a search verb, read off the dependency tree."""
        for token in doc:
            if token.pos_ != "VERB" or normalize(token.lemma_) not in SEARCH_VERBS:
                continue
            for child in token.children:
                target = child
                # "search for Rabta" hangs the noun on a case marker: the noun is wanted
                if child.dep_ in ("case", "mark") or child.pos_ in ("ADP", "PART", "SCONJ"):
                    target = next((grandchild for grandchild in child.children if grandchild.dep_ == "pobj"), None)
                if target is None or target.pos_ in ("PUNCT", "PRON", "ADP", "PART", "AUX", "VERB"):
                    continue
                # the head noun with its modifiers only: "the hospitals that mention
                # Rabta" asks about Rabta, not about the whole noun phrase
                parts = [
                    token
                    for token in doc[target.left_edge.i : target.right_edge.i + 1]
                    if token.i == target.i or token.dep_ in ("compound", "amod", "poss", "nummod")
                ]
                phrase = normalize(" ".join(token.text for token in parts))
                # a phrase the vocabulary already resolves, in spelling or in lemma, is an
                # entity of the question, not the word it is looking for
                if len(phrase) < 3 or self.lexicon.lookup(phrase, lang) or self.lexicon.lookup(
                    normalize(target.lemma_), lang
                ):
                    continue
                return phrase
        return ""

    def _by_identity(self, local: str, kind: str, lang: str) -> Any:
        for candidate in self.lexicon.terms:
            if candidate.local == local and candidate.kind == kind and candidate.lang == (lang or "en"):
                return candidate
        return next(
            (c for c in self.lexicon.terms if c.local == local and c.kind == kind),
            None,
        )

    def _fuzzy_pass(self, doc: Any, blocked: set[int], lang: str) -> tuple[list[Entity], set[int], dict[int, str]]:
        tokens = [t.text for t in doc]
        model = lang or "en"
        terms, choices = self._fuzz_terms.get(model, []), self._fuzz_choices.get(model, [])
        if not choices:
            return [], set(), {}
        out: list[Entity] = []
        used: set[int] = set()
        rewrites: dict[int, str] = {}
        for index, span in enumerate(tokens):
            if index in used or index in blocked:
                continue
            # a two letter token is a prefix of far too many surfaces to be trusted
            if len(span) < 4:
                continue
            # the written word and its lemma are both compared: "sumptoms" is one letter
            # away from the lemma "symptom", while its ratio to the surface is too low
            candidates = {span, doc[index].lemma_}
            scored: list[tuple[str, float, int]] = []
            for candidate in candidates:
                for surface, score, position in process.extract(
                    candidate, choices, scorer=fuzz.ratio, score_cutoff=80, limit=5
                ):
                    if _typo_or_close(candidate, surface, score):
                        scored.append((surface, score, position))
            picked = self._prefer(scored, terms, lang, span)
            if picked is None:
                continue
            term, score = picked
            out.append(_entity_from(term, span, "rapidfuzz", score / 100))
            used.add(index)
            rewrites[index] = term.surface
        return out, used, rewrites

    def _property_pass(self, doc: Any, blocked: set[int], lang: str) -> list[Entity]:
        """Property names are matched last so they can never shadow a class or individual."""
        matcher = self.property_matchers.get(lang or "en") or self.property_matchers["en"]
        out: list[Entity] = []
        used: set[int] = set()
        for _key, start, end in matcher(doc):
            if any(i in used or i in blocked for i in range(start, end)):
                continue
            surface = " ".join(t.text for t in doc[start:end])
            terms = self.lexicon.lookup(surface, lang)
            term = next((t for t in terms if t.kind == "property"), None)
            if term is None:
                continue
            out.append(_entity_from(term, surface, "spacy-phrase-matcher", 1.0))
            used.update(range(start, end))
        return out

    def _prefer(self, scored: list[tuple[str, float, int]], terms: list[Term], lang: str, span: str) -> Any:
        """Best fuzzy hit that is acceptable for the question language and term kind."""
        best: Any = None
        best_rank: tuple[float, int, int] | None = None
        for surface, score, index in scored:
            term = terms[index]
            # both vocabularies are candidates whatever the detected language is,
            # the ranking below only prefers the one of the question
            shorter, longer = (len(surface), len(span)) if len(surface) <= len(span) else (len(span), len(surface))
            if shorter * 4 < longer * 3:
                continue
            rank = (-score, KIND_PRIORITY.get(term.kind, 4), 0 if term.lang == lang else 1)
            if best_rank is None or rank < best_rank:
                best_rank, best = rank, (term, score)
        return best

    def matcher_for(self, lang: str) -> PhraseMatcher:
        """A PhraseMatcher over the class surfaces, used by the intent rules."""
        return self._matcher(("class",))


def _span_indices(doc: Any, covered: set[int]) -> set[int]:
    """Map character offsets to token indices."""
    indices: set[int] = set()
    for token in doc:
        if any(token.idx + i in covered for i in range(len(token.text))):
            indices.add(token.i)
    return indices


def extract_values(text: str) -> dict[str, Any]:
    """Numbers, comparators, dates and limits: the numeric slots of the intents."""
    plain = normalize(text)
    slots: dict[str, Any] = {}

    for pattern, operator in COMPARATOR_PATTERNS:
        match = pattern.search(plain)
        if not match:
            continue
        groups = [int(g) for g in match.groups()]
        if operator == "between":
            slots["age_min"], slots["age_max"] = groups[0], groups[-1]
            slots["age_operator"] = "between"
        else:
            slots["age_operator"] = operator
            slots["age_value"] = groups[0]
        break

    limit_match = next((m for p in LIMIT_PATTERNS for m in [p.search(plain)] if m), None)
    if limit_match:
        slots["limit"] = int(limit_match.group(1))

    iso = ISO_DATE.search(plain)
    if iso:
        slots["date"] = f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
        # the comparator is the wording just before the date, never after it
        context = plain[max(0, iso.start() - 24) : iso.start()]
        if DATE_AFTER.search(context):
            slots["date_operator"] = "after"
        elif DATE_BEFORE.search(context):
            slots["date_operator"] = "before"
    else:
        partial = DATE_WITHOUT_DAY.search(plain)
        if partial:
            slots["date"] = f"{partial.group(1)}-{partial.group(2)}"
        month = next((m for word, m in MONTHS.items() if re.search(rf"\b{word}\b", plain)), None)
        if month:
            slots["month"] = month
        year = re.search(r"\b(20\d{2})\b", plain)
        if year:
            slots["year"] = int(year.group(1))

    blood = BLOOD_TYPE.search(plain)
    if blood:
        slots["blood_type"] = f"{blood.group(1)}{blood.group(2)}".upper()

    for word in RESULT_WORDS:
        if word in plain:
            slots["result"] = word
            break

    if re.search(r"\b(latest|recent|upcoming|next|prochain|recent|dernier)\b", plain):
        slots["order"] = "desc"
    if re.search(r"\b(oldest|first|earliest|ancien|premier)\b", plain):
        slots["order"] = "asc"
    if re.search(r"\b(all|tous|toutes|list of|liste des|list the|lister)\b", plain):
        slots["all"] = True
    return slots


def keyword_bag(text: str) -> list[str]:
    return words_of(text)
