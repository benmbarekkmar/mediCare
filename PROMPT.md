# MISSION

You are a senior full-stack engineer. Build the COMPLETE, production-quality "MedicCare" application inside the current workspace folder `medicare/`, which contains two EMPTY folders: `backend/` and `frontend/`. Do everything: scaffolding, code, configuration, seed data, tests, documentation. Do not stop until the application runs end to end. No placeholders, no TODOs, no lorem ipsum, no mocked data in the UI: every screen must use the real backend, which must execute real SPARQL against a real triple store.

This is the final mini-project of a university "Semantic Web" module. Academic requirements (mandatory):
1. Domain ontology (OWL) with ObjectProperties, DataProperties, individuals and axioms: ALREADY PROVIDED (see ONTOLOGY section). Do not redesign it.
2. Graphical interfaces: a FRONT-OFFICE (patient portal) and a BACK-OFFICE (staff: admin, doctor, receptionist). Technology: Angular (front), Node.js (back).
3. SPARQL queries executed by the server: full CRUD, filtering, searching, sorting, pagination, aggregation.
4. Front-end <-> back-end communication via a REST API.
5. A Natural Language Processing (NLP/TALN) module acting as an intelligent translator: it takes a user's question in natural language and converts it into an executable SPARQL query that the server runs.
   FORBIDDEN: any turnkey LLM API (Gemini, OpenAI, Anthropic, etc.) or prompt-engineering based conversion. The conversion MUST be implemented with NLP libraries (spaCy, NLTK, scikit-learn, Hugging Face Transformers / sentence-transformers, etc.). The tools used must be documented explicitly (see DELIVERABLES) because they will be named in the presentation.

# WORKING METHOD

- Work in phases (0..9 below). After each phase: install, build, run, test, and fix every error before moving on.
- Actually run Fuseki, load the ontology, and verify queries return correct results. Verify the Angular build (`ng build`) passes with zero errors and the backend tests pass.
- Never hardcode data that should come from the triple store. Never leave dead buttons, empty pages or unreachable routes.
- Keep code clean: TypeScript strict mode, small modules, no duplication, meaningful names, comments only where useful, ESLint + Prettier configured.
- At the end, run a full self-review against the FINAL CHECKLIST and fix anything missing.

# TECH STACK (fixed)

Backend (`medicare/backend/`):
- Node.js 20+ LTS, TypeScript (strict), Express, zod (validation), axios (SPARQL HTTP), jsonwebtoken + bcrypt (auth), helmet, cors, express-rate-limit, pino (logging), swagger-ui-express (OpenAPI docs at /api/docs), vitest or jest + supertest (tests), dotenv.
- Triple store: Apache Jena Fuseki, dataset `/medicare` (query: /medicare/query, update: /medicare/update). Provide `docker-compose.yml` at `medicare/` for Fuseki (verify the image name and env vars actually work) AND a documented manual alternative (running fuseki-server locally with `--update --mem /medicare`) plus a script `backend/scripts/load-ontology` that (re)loads `backend/ontology/MedicCare_final_fuseki_en.ttl` into the dataset (clear + load) and a script to reset/seed.
- Auth/users store (NOT in the ontology): lightweight SQLite (better-sqlite3) file `backend/data/app.db` for users, refresh tokens and audit log. Each staff/patient user can be linked to an ontology individual IRI (e.g. Doctor_Ali, Patient_Ahmed).
- NLP microservice: `backend/nlp-service/` in Python 3.10+, FastAPI + uvicorn, spaCy (models en_core_web_md and fr_core_news_md), RapidFuzz, scikit-learn, sentence-transformers (optional, env flag USE_EMBEDDINGS), langdetect, pytest. Node calls it over HTTP; if it is down, Node returns a clear 503 and the UI shows a friendly message.

Frontend (`medicare/frontend/`):
- Latest stable Angular (standalone components, signals, new control flow, lazy-loaded routes, typed reactive forms, functional guards/interceptors), TypeScript strict.
- Tailwind CSS + Angular CDK for the design system (build your own components, no heavy UI kit), lucide-angular icons, Inter font, Chart.js (ng2-charts) for charts, Cytoscape.js for the ontology/relationship graphs, CodeMirror 6 for the SPARQL editor (syntax highlighting), FullCalendar for the calendar, ngx-translate for i18n (English default + French).

# ONTOLOGY (source of truth, already built and reasoner-validated)

Files (the user will place them in `backend/ontology/`): `MedicCare_final_en.ttl` (asserted ontology) and `MedicCare_final_fuseki_en.ttl` (same + materialized inferences, to load in Fuseki, since Fuseki runs WITHOUT a reasoner). If missing, create the loader anyway and print a clear message.

Namespace (prefix `:`): http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#
Individuals use IRIs like :Patient_Ahmed, :Doctor_Ali, :Diabetes, :Metformin, :Hospital_CharlesNicolle, :CardiologyDepartment_01, :BloodTest_001, :Appointment_001, :Fever_01, :DiabetesTreatment.

Top-level classes (pairwise disjoint) and subclasses:
- Patient: AdultPatient (18-64), ChildPatient (<18), ElderlyPatient (>=65), ChronicPatient (has a ChronicDisease), EmergencyPatient (has an EmergencyAppointment)
- Doctor: GeneralPractitioner, EmergencyPhysician, Cardiologist, Dermatologist, Neurologist
- Disease: InfectiousDisease, ChronicDisease, CardiovascularDisease, RespiratoryDisease (a disease can have several)
- Symptom: Fever, Headache, Cough, Fatigue, ChestPain, SkinRash
- Treatment: MedicationTreatment, SurgicalTreatment, Physiotherapy
- Medication: Antibiotic, Analgesic, Antiviral, Antihypertensive, Antidiabetic
- MedicalTest: BloodTest, UrineTest, XRay, MRI, CTScan
- Hospital: PublicHospital, PrivateHospital, UniversityHospital
- MedicalAppointment: Consultation, FollowUpAppointment, EmergencyAppointment
- MedicalDepartment: CardiologyDepartment, DermatologyDepartment, NeurologyDepartment, EmergencyDepartment, GeneralMedicineDepartment

Object properties (domain -> range, inverse): hasDisease (Patient->Disease, isDiseaseOf); treatedBy (Patient->Doctor, treats); hasSymptom (Disease->Symptom, isSymptomOf); hasTreatment (Disease->Treatment, isTreatmentOf); usesMedication (Treatment->Medication, isUsedIn); undergoesTest (Patient->MedicalTest, isTestOf); hasAppointment (Patient->MedicalAppointment, appointmentOf); worksIn (Doctor->MedicalDepartment, hasDoctor, functional); locatedIn (MedicalDepartment->Hospital, hasDepartment, functional); belongsToDepartment (MedicalAppointment->MedicalDepartment, includesAppointment, functional). Property chains: followedInDepartment = treatedBy o worksIn; followedInHospital = followedInDepartment o locatedIn.

Data properties (all functional): Patient: hasName (string), hasAge (integer), hasGender ("Male"|"Female"), hasBloodType ("A+","A-","B+","B-","AB+","AB-","O+","O-"), hasPhoneNumber. Doctor: doctorName, doctorLicenseNumber (unique key, e.g. MED-45821). Disease: diseaseName, diseaseDescription. Symptom: symptomName. Treatment: treatmentName, treatmentDuration. Medication: medicationName, medicationDosage. MedicalTest: testDate (xsd:dateTime), testResult. MedicalAppointment: appointmentDate (xsd:dateTime), appointmentStatus ("Pending"|"Confirmed"|"Completed"|"Cancelled"). Hospital: hospitalName (unique key). MedicalDepartment: departmentName.
Labels: every class/property/individual has rdfs:label (@en), many have skos:altLabel synonyms.

Axioms the app must RESPECT on every write (implement as a validation layer, return 422 with clear messages):
- Doctor: worksIn exactly 1 department; specialty must match department (Cardiologist->CardiologyDepartment, Dermatologist->DermatologyDepartment, Neurologist->NeurologyDepartment, EmergencyPhysician->EmergencyDepartment, GeneralPractitioner->GeneralMedicineDepartment); license number unique.
- Department: locatedIn exactly 1 hospital. Appointment: belongsToDepartment exactly 1 department; EmergencyAppointment must belong to an EmergencyDepartment; appointment date required.
- Patient: needs name, age, at least 1 doctor (treatedBy) and 1 disease; age class assigned automatically (Child/Adult/Elderly) and the base class Patient asserted too.
- Value-set data properties must use the allowed values; functional properties are updated with DELETE/INSERT (never duplicated).

WRITE-CONSISTENCY RULE (critical): Fuseki has no reasoner, so the backend must keep the graph materialized on every create/update/delete, in one atomic SPARQL Update per operation: (a) assert the most specific class AND all its superclasses (e.g. Cardiologist + Doctor + owl:NamedIndividual), (b) assert BOTH directions of every inverse pair, (c) recompute ChronicPatient/EmergencyPatient membership, Adult/Child/Elderly class, and followedInDepartment/followedInHospital for affected patients, (d) add rdfs:label for new individuals, (e) on delete remove all triples where the individual is subject or object. Build this once as an `OntologyWriter` service driven by a metadata registry (entity -> class, id prefix, properties, inverses, validations) so all entities share the same generic code.
ID generation: `<Prefix>_<Slug>` for people/hospitals (e.g. Patient_Karim, with numeric suffix on collision), sequential for tests/appointments/departments (BloodTest_006, Appointment_011).
Delete rules: patient delete cascades to their appointments and tests; doctor/department/hospital/disease/treatment/medication/symptom delete is blocked with 409 and a list of dependents (offer reassignment where relevant).

# PHASE 0 — Project scaffolding
Root `medicare/`: README.md, docker-compose.yml, .gitignore, .editorconfig, `docs/`. Backend and frontend as specified, with `.env.example`, npm scripts (dev, build, test, lint, seed, load-ontology), and one root script/README section to start everything (Fuseki, NLP service, backend, frontend).

# PHASE 1 — Backend core + SPARQL layer
- `SparqlClient` (select/ask/construct/update, timeouts, error mapping, query logging), `PrefixRegistry`, safe query builders with parameter binding and strict escaping of literals/IRIs (no string concatenation of raw user input; validate IDs with a regex). Prevent SPARQL injection.
- Generic entity repository and REST controllers for: patients, doctors, diseases, symptoms, treatments, medications, tests, appointments, hospitals, departments. Each supports:
  GET /api/<entity>?q=&page=&pageSize=&sort=&order=&<filters> (server-side search using FILTER(CONTAINS(LCASE(...))), filters, sorting, LIMIT/OFFSET + total COUNT), GET /api/<entity>/:id (with related entities resolved), POST, PUT (partial update allowed), DELETE.
  Entity-specific filters: patients (ageGroup, gender, bloodType, disease, doctor, chronic, emergency), doctors (specialty, department, hospital), diseases (category), medications (class), tests (type, date range, patient), appointments (status, type, department, date range, patient, doctor), departments (hospital, type), hospitals (type).
- Dashboard stats endpoint: KPIs (patients, doctors, diseases, hospitals, departments, appointments today/upcoming), patients by age group, top diseases by patient count, appointments per month, appointments by status, tests by type, patients per hospital.
- Ontology endpoints: GET /api/ontology/classes (tree with instance counts), /api/ontology/properties (with domain/range/inverse/characteristics), /api/ontology/individuals?class=, /api/ontology/graph?focus=<id>&depth=<n> (nodes/edges JSON for Cytoscape).
- Admin SPARQL console endpoint: POST /api/sparql with {query, type}; allow SELECT/ASK/CONSTRUCT/DESCRIBE and INSERT/DELETE/UPDATE for ADMIN only; block DROP, CLEAR, LOAD, CREATE, COPY, MOVE, ADD; enforce timeout and LIMIT cap; return bindings, execution time, row count; log to audit.
- Global search endpoint: GET /api/search?q= across all entities (grouped results).
- Consistent error format {status, code, message, details}, request validation with zod, pagination envelope {items, page, pageSize, total}, OpenAPI documented, rate limiting, helmet, CORS from env.

# PHASE 2 — Auth, roles, permissions (RBAC) and data scoping
Roles: ADMIN, DOCTOR, RECEPTIONIST, PATIENT. JWT access token (15 min) + refresh token (rotating, stored hashed), bcrypt password hashing, login/logout/refresh/me, patient self-registration (creates the Patient individual AND the user, linked), change password, admin user management (CRUD, activate/deactivate, assign role, link to ontology individual).
Enforce permissions in the BACKEND (route middleware + data scoping), never only in the UI:
- ADMIN: everything; users, audit log, SPARQL console (read+write), ontology explorer, all CRUD.
- DOCTOR: sees only patients where treatedBy = own linked Doctor individual (scoping applied inside SPARQL); can update a patient's medical info (diseases, tests, appointments of own patients), create tests and appointments for own patients, read all knowledge base (diseases, symptoms, treatments, medications), read hospitals/departments/doctors, use AI assistant (read-only), ontology explorer (read-only). Cannot delete master data or manage users.
- RECEPTIONIST: full CRUD on appointments; create/edit patients (identity and contact data, assign doctor), read doctors/departments/hospitals; no access to diagnoses, tests, SPARQL console or user management.
- PATIENT: only own record (profile, diseases, treatments with medications and dosages, tests and results, appointments, own doctors); can request a new appointment (status Pending) and cancel own Pending/Confirmed appointment; can browse doctors, hospitals, departments and the health library (diseases, symptoms, medications) read-only; AI assistant limited to general knowledge intents and "my ..." intents scoped to own data.
- Audit log: every write (who, role, action, entity, timestamp, payload summary) stored in SQLite; viewable by ADMIN with filters.
- Seed demo users (documented in README): admin@mediccare.com / Admin@123 (ADMIN); ali@mediccare.com (DOCTOR linked to Doctor_Ali); salma@mediccare.com (DOCTOR linked to Doctor_Salma); reception@mediccare.com (RECEPTIONIST); ahmed@mediccare.com (PATIENT linked to Patient_Ahmed); mariam@mediccare.com (PATIENT linked to Patient_Mariam). Use strong documented demo passwords.

# PHASE 3 — NLP module (Natural Language -> SPARQL) in `backend/nlp-service/`
Goal: translate a user question (English OR French) into a safe, executable SPARQL SELECT/ASK query. NO LLM API. Pipeline (implement every step, modular and unit-tested):
1. Language detection (langdetect) and spaCy pipeline selection (en_core_web_md / fr_core_news_md). Normalization (lowercase, accents handling, punctuation), tokenization, lemmatization, POS tags, dependency parse, stopword handling.
2. Lexicon built at startup AND refreshable (POST /reload) by querying Fuseki: all class labels, property labels, individual labels (rdfs:label), synonyms (skos:altLabel), patient/doctor names, hospital and department names; PLUS a hand-written bilingual file `data/lexicon_fr.json` with French translations/synonyms for classes, diseases, symptoms, medications, tests, specialties, departments and property verbs (the ontology itself is English-only).
3. Entity recognition and linking: spaCy PhraseMatcher/EntityRuler on lemmas + RapidFuzz fuzzy matching for typos; return entity {text, type (class|individual|property|value), iri, score}. Handle numbers, comparators ("older than 50", "plus de 50 ans", "between 20 and 40"), dates, blood types, genders, statuses, specialties, ordering and limits ("top 5", "latest").
4. Intent classification: hybrid of (a) rule patterns using spaCy Matcher / dependency cues and (b) a trained classifier — sentence-transformers multilingual embeddings (e.g. paraphrase-multilingual-MiniLM-L12-v2) with cosine similarity to an example bank when USE_EMBEDDINGS=true, otherwise scikit-learn TF-IDF + LogisticRegression. You must GENERATE the training/example data `data/intents.jsonl` (at least 250 labeled EN+FR questions covering all intents below, with paraphrases). Return intent + confidence; below threshold return a "not understood" result with 3-5 suggested questions.
5. Slot filling and SPARQL generation from a template library (one parameterized template per intent, built with safe escaping, never string-concatenating raw text; prefixes included; LIMIT applied). Supported intents (minimum 30), e.g.:
   list_instances (all patients/doctors/hospitals/departments/diseases/medications/tests/appointments), count_instances, describe_individual (all properties), disease_symptoms, disease_treatments, disease_medications, disease_description, symptom_diseases (diseases with symptom X), disease_patients, patient_diseases, patient_doctor, doctor_patients, doctor_department, doctor_hospital, doctors_by_specialty, department_doctors, department_hospital, hospital_departments, hospital_doctors, patient_tests, tests_by_type, tests_by_result, patient_appointments, appointments_by_status, appointments_by_date/range, appointments_by_department, upcoming_appointments, emergency_patients, chronic_patients, patients_by_age_group, patients_by_age_comparator, patients_by_blood_type, patients_by_gender, medication_dosage, medications_by_class, treatment_medications, treatment_duration, search_by_keyword (FILTER CONTAINS), top_diseases_by_patients, followed_in_hospital, ask (boolean questions, e.g. "Does Ahmed have diabetes?").
6. Output JSON: {question, language, intent, confidence, entities[], slots, sparql, explanation (human-readable in the user's language), suggestions[]}. Also provide POST /parse (parse only) and GET /health.
7. Node side: POST /api/nlp/ask {question} -> calls the Python service -> VALIDATES the generated SPARQL (only SELECT/ASK, no update keywords, LIMIT enforced, role restrictions: PATIENT role may only run general-knowledge intents and own-data intents with the patient's IRI injected server-side; DOCTOR results are scoped to own patients) -> executes on Fuseki -> returns {parse, sparql, columns, rows, executionMs}. Allow "edit and re-run" of the generated SPARQL through the console endpoint for ADMIN.
8. Evaluation: `tests/test_nlp.py` with at least 80 question -> expected intent/SPARQL-result cases (EN and FR) and a script that prints accuracy per intent and overall (target >= 90%). Include handling of typos, synonyms, and word order variations.
Examples that must work: "Which symptoms does diabetes have?", "Quels sont les symptômes de la grippe ?", "List the patients older than 40", "Who is the doctor of Ahmed?", "Medications used for hypertension", "How many appointments are pending?", "Doctors working in cardiology", "Which hospital hosts the neurology department?", "Patients with chronic diseases", "Dosage of Metformin", "Does Mariam have hypertension?", "Appointments after 2026-11-01".

# PHASE 4 — Frontend foundations and design system
Design: modern, clean, trustworthy healthcare product. Light + dark themes (system default, user toggle, persisted). Palette: primary blue #2563EB, secondary teal #14B8A6, accent violet #8B5CF6, slate neutrals, semantic colors (green confirmed/completed, amber pending, red cancelled/critical, blue info). Inter font, 12px card radius, 8px input radius, soft shadows, subtle gradients on KPI/hero cards, 4/8px spacing scale, consistent 200ms transitions, respect prefers-reduced-motion. Accessibility WCAG 2.1 AA (contrast, focus rings, ARIA, keyboard navigation, labels, skip link).
Build a reusable component library in `shared/ui`: Button (variants, loading), Input, Textarea, Select, Combobox/Autocomplete (async, for choosing patients/doctors/diseases etc.), DatePicker/DateTimePicker, Checkbox/Radio/Switch, Chip/Badge (status colors), Avatar (initials), Card, StatCard, DataTable (server-side sort, pagination, column visibility, row actions, selection, sticky header, skeleton rows, empty state, CSV export), Tabs, Modal, Drawer, ConfirmDialog, Toast, Tooltip, Dropdown menu, Breadcrumb, Pagination, Skeleton, EmptyState, ErrorState, Stepper, Timeline, Alert, CodeBlock (copy button), FilterBar (URL-synced query params), PageHeader.
App shell: collapsible sidebar (grouped navigation, icons, active state, role-based menu), top bar (global search with live grouped results from /api/search and Ctrl+K command palette, notifications for upcoming appointments, theme toggle, language switch EN/FR, user menu), breadcrumbs, responsive (desktop, tablet, mobile with off-canvas drawer). Core: HTTP interceptors (JWT attach, refresh on 401, global error -> toast), route guards by role, typed API services, global error handling, loading states everywhere, debounced search (300 ms), URL-synced filters/pagination, form validation with inline messages, unsaved-changes guard on forms.

# PHASE 5 — Public pages and shared pages
- /login (split layout, illustration, validation, show/hide password, demo-account quick-fill buttons in dev), /register (patient self-registration with the patient data fields), /forgot-password (UI flow with backend endpoint stub that is documented), 404, 403, 500 error pages.
- Profile & settings (all roles): edit own info, change password, theme, language; ADMIN also sees read-only Fuseki endpoint status/health and ontology stats (triples count, classes, individuals).

# PHASE 6 — BACK-OFFICE: ADMIN views (all complete pages)
Dashboard (KPI cards, appointments per month line chart, patients by age group donut, top diseases bar chart, appointments by status, tests by type, upcoming appointments list, recent tests, quick actions). Then, for EACH of: Patients, Doctors, Diseases, Symptoms, Treatments, Medications, Medical Tests, Appointments, Hospitals, Departments — build list (search, filters as chips, sort, pagination, bulk actions where sensible, CSV export), detail page (header + tabs with all relations navigable via links, relationship mini-graph), create/edit form (all data properties + relation pickers, validation reflecting the axioms, with specialty/department consistency checks), delete with confirmation and dependency handling. Appointments additionally have a calendar view (month/week/day, color-coded by status/type, click to create/edit, drag to reschedule). Patient detail: profile header, tabs Overview / Diseases / Doctors / Tests / Appointments / Timeline, "Print medical record" (print stylesheet). Disease detail: description, symptoms, treatments (with medications and dosages), patients. Hospital detail: departments, doctors, appointments counts, map-like cards. Department detail: doctors, appointments.
Plus: User management (table, create/edit/deactivate, role assignment, link to ontology individual), Audit log (filters by user/action/entity/date), AI Assistant, SPARQL Console, Ontology Explorer (details in Phase 9).

# PHASE 7 — BACK-OFFICE: DOCTOR and RECEPTIONIST views
DOCTOR: Dashboard (today's appointments, my patients count, pending tests, my department/hospital, upcoming week). My Patients (list + detail = full medical record with tabs; actions: add/remove diagnosis, add test with result, schedule appointment, update patient info allowed fields). My Appointments (calendar + list, change status Confirmed/Completed/Cancelled). Tests (of own patients, add/edit). Knowledge Base (Diseases, Symptoms, Treatments, Medications read-only with cross-links). AI Assistant (results scoped to own patients). Ontology Explorer (read-only). Profile.
RECEPTIONIST: Dashboard (today's appointments by status, pending confirmations, quick "new appointment"/"new patient"). Appointments (full CRUD with calendar, conflict warning if same doctor/department and same date-time). Patients (create/edit identity and contact info, assign doctor; no medical details). Directory (doctors, departments, hospitals read-only). Profile.

# PHASE 8 — FRONT-OFFICE: PATIENT portal (distinct, friendlier layout)
Dashboard (greeting, next appointment card, my doctor(s), my conditions, latest test results, health tips from the knowledge base). My Medical Record (conditions with symptoms, treatments and medications with dosage and duration, tests with results and dates; printable summary). My Appointments (list + calendar, request new appointment via stepper: department -> doctor -> date/time -> confirm; cancel; status badges). Find a Doctor (search/filter by specialty, department, hospital; doctor cards with department/hospital). Hospitals & Departments directory. Health Library (searchable diseases, symptoms, medications pages with cross-links). AI Health Assistant (limited intents, example-question chips, results rendered as readable cards/tables). Profile.

# PHASE 9 — Smart tools UI
AI Assistant (ADMIN, DOCTOR, PATIENT with limits): chat-style interface; the user types in EN or FR; show typing state; then render for each answer: (a) detected language, intent and confidence, entities as colored chips, (b) the generated SPARQL in a syntax-highlighted block with Copy and "Open in console" (ADMIN only), (c) results as table or cards with export CSV, (d) a short human-readable explanation, (e) "not understood" fallback with suggested questions, (f) conversation history in a side panel (persisted locally), (g) clickable example questions grouped by category, (h) voice input via Web Speech API when supported (optional enhancement).
SPARQL Console (ADMIN): CodeMirror editor with line numbers and SPARQL highlighting, prefix helper, templates dropdown (SELECT, FILTER, search, INSERT DATA, DELETE/INSERT WHERE, DELETE WHERE, ASK, CONSTRUCT, COUNT/GROUP BY) filled with real examples of this ontology, run (Ctrl+Enter), results table with execution time/row count/errors, export CSV/JSON, query history and saved queries.
Ontology Explorer: left class hierarchy tree with instance counts and search; center interactive graph (Cytoscape: classes and individuals, expand neighbors, zoom, fit, layout switch, filter by class/property, legend, click node to focus); right details panel (selected class/individual: label, IRI, types, data properties, object properties with links, domain/range/inverse/characteristics for properties, axioms in readable form: disjointness, restrictions, equivalent classes with the age-range definitions). Tabs: Classes, Object Properties, Data Properties, Individuals.

# UX QUALITY BAR (apply everywhere)
Skeleton loaders (no layout jumps), meaningful empty states with CTA, friendly error states with retry, toasts for every action result, confirmation for destructive actions, optimistic UI where safe, inline validation, disabled/loading buttons during submit, focus management in modals, keyboard shortcuts (Ctrl+K search, Ctrl+Enter run query, Esc close), consistent iconography, status color semantics identical across the app, no horizontal scroll on mobile, tables degrade to cards on small screens, smooth route transitions, page titles per route.

# TESTING
Backend: unit tests (query builders, validators, OntologyWriter materialization incl. inverses/types/derived classes), integration tests with supertest against a test Fuseki dataset (CRUD per entity, filters, pagination, RBAC and scoping for each role, injection attempts blocked). NLP: pytest suite and accuracy report (Phase 3). Frontend: unit tests for services/guards/key components, plus a few Playwright e2e flows (login per role, create patient, create appointment, AI question -> SPARQL -> results).

# DELIVERABLES
- Working `medicare/` project (backend, frontend, nlp-service, docker-compose, scripts) that starts with documented commands.
- `README.md`: architecture diagram (mermaid), prerequisites, setup, env vars, how to load the ontology into Fuseki, how to run each part, demo accounts per role, role/permission matrix, API overview, troubleshooting.
- `docs/tools-used.md`: explicit list of every tool/library used with its purpose, with a dedicated section "NLP/TALN tools" (spaCy, models, RapidFuzz, scikit-learn, sentence-transformers/Hugging Face, langdetect) describing each pipeline step, to be cited in the presentation; state clearly that NO LLM API is used.
- `docs/sparql-examples.md`: at least 25 real SPARQL examples (SELECT, FILTER, search, aggregation, INSERT, UPDATE, DELETE, ASK, CONSTRUCT) against this ontology.
- `docs/nlp-evaluation.md`: accuracy results and example question -> SPARQL translations.
- `docs/demo-script.md`: a 10-minute demo scenario touching every role and the AI assistant.
- OpenAPI docs at /api/docs.

# FINAL CHECKLIST (verify each item yourself before finishing)
[ ] Fuseki runs, ontology loaded, sample queries return the expected individuals.
[ ] Every entity has complete CRUD through the UI and API, with search, filters, sort, pagination.
[ ] All 4 roles have complete views; unauthorized routes/endpoints are blocked (verify with tests); data scoping works for DOCTOR and PATIENT.
[ ] Ontology axioms and the write-consistency rule are enforced; the graph stays consistent after create/update/delete (inverses, superclass types, derived classes, chain properties).
[ ] NLP translates EN and FR questions into correct SPARQL, executes them, and reaches >= 90% on the evaluation set; no LLM API is used anywhere.
[ ] SPARQL console, ontology explorer, dashboard charts, calendar, print record all work with real data.
[ ] Light/dark themes, EN/FR, responsive, accessible; no console errors; `ng build` and backend/NLP tests pass.
[ ] README and docs are complete and accurate.

Begin with Phase 0 now, and continue through all phases without asking for confirmation. Only stop to ask if a file in `backend/ontology/` is missing or a command cannot succeed after several fixes.