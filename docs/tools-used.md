# Tools and libraries used

## Application stack

- **Angular 18, TypeScript, RxJS and Angular Router:** standalone, lazy-loaded front end, typed API services, route guards and reactive forms.
- **Angular CDK and Tailwind CSS:** accessible interaction primitives and the project's utility styling.
- **Lucide Angular:** consistent interface icons.
- **Chart.js with ng2-charts:** dashboard charts.
- **Cytoscape.js:** ontology and relationship graph rendering.
- **CodeMirror 6:** SPARQL editing, syntax support and keyboard-driven execution.
- **FullCalendar:** month, week and day appointment views, with interaction support for rescheduling.
- **ngx-translate:** English and French interface messages.
- **Node.js 20+, TypeScript and Express:** REST API and server-side authorization.
- **Zod:** request and environment validation.
- **Axios:** SPARQL HTTP transport.
- **Apache Jena Fuseki:** RDF dataset and SPARQL query/update endpoint.
- **SQLite via better-sqlite3:** accounts, refresh tokens and audit events; clinical graph facts are stored in Fuseki.
- **jsonwebtoken and bcrypt:** signed access/refresh sessions and password hashing.
- **Helmet, CORS, express-rate-limit, pino and pino-http:** HTTP hardening, origin policy, throttling and structured logs.
- **swagger-ui-express with an OpenAPI 3 document:** interactive API documentation at `/api/docs`.
- **Vitest and Supertest:** backend unit and HTTP integration tests.
- **Jasmine, Karma and Chrome Headless:** Angular unit tests.

## NLP/TALN tools

The NLP service is a local FastAPI application. Node sends a question to it over HTTP; the service returns an intent, extracted entities and slots, and a parameter-safe SPARQL template. The API applies role policy and executes the query through Fuseki.

1. **Language detection — `langdetect`:** identifies English or French. A requested locale can provide an explicit language hint.
2. **Normalization — Python `unicodedata` and regular expressions:** lowercases text, folds accents and normalizes punctuation for matching.
3. **Tokenization, lemmatization and dependency cues — spaCy:** uses `en_core_web_md` or `fr_core_news_md` to normalize terms and identify search phrases.
4. **Ontology entity recognition — spaCy `EntityRuler` and `PhraseMatcher`:** matches class, individual, property and value surfaces from Fuseki. When Fuseki is unavailable during service startup, the bundled Turtle vocabulary supplies a read-only fallback for parsing.
5. **Typo matching — RapidFuzz:** checks conservative single-token near matches against ontology terms.
6. **Numbers, dates and constrained values — regular-expression slot extractors:** recognizes ages, date ranges, appointment statuses, result terms, blood groups and requested limits.
7. **Intent choice — rule candidates plus scikit-learn:** ordered cue and slot rules are checked first; a local TF-IDF character n-gram Logistic Regression model trained from `data/intents.jsonl` provides fallback classification and confidence scores.
8. **SPARQL generation — the service's fixed template library:** each supported intent maps to a read-only `SELECT` or `ASK` template. User text is escaped as a literal; identifiers are resolved from the vocabulary and validated before query construction.
9. **Optional semantic retrieval — sentence-transformers / Hugging Face:** an optional local embedding backend can be enabled with `USE_EMBEDDINGS=true`. It is off by default and is not required by the standard setup.

## No LLM API

**NO LLM API is used.** The question-to-SPARQL conversion is implemented with language models, lexical matching, explicit rules and a locally trained scikit-learn classifier. No Gemini, OpenAI, Anthropic or other hosted text-generation endpoint receives user questions. Fuseki receives the generated SPARQL directly.
