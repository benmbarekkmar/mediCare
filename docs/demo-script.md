# Ten-minute demo script

Use the seeded data loaded from `MedicCare_final_fuseki_en.ttl`. Sign in with the addresses below and the private `SEED_DEMO_PASSWORD` configured for this demo environment. Avoid showing real patient information; the bundled records are sample data.

| Time | Role | Walkthrough |
| --- | --- | --- |
| 0:00–0:45 | Introduction | Explain the split: Angular UI, Express policy/API layer, Fuseki graph, SQLite accounts/audit, and local NLP service. Open the public health library and a disease detail page. |
| 0:45–2:00 | RECEPTIONIST | Sign in as `reception@medicare.tn`. Open the appointment desk, review today's schedule and status filters, then start the new appointment flow. Show patient identity editing and the doctor/hospital directory. |
| 2:00–3:30 | DOCTOR | Sign in as `salma.benali@medicare.tn`. Open today's work, inspect a followed patient and their conditions, tests and appointments. Show a knowledge-base entry and the assistant's patient-scoped examples. |
| 3:30–4:45 | PATIENT | Sign in as `ahmed@medicare.tn`. Show the distinct patient portal, next appointment, own medical record and printable summary. Open the appointment request stepper and demonstrate that records are limited to the linked account. |
| 4:45–7:15 | ADMIN | Sign in as `admin@medicare.tn`. Show dashboard charts, one entity list/detail/form, user roles, audit filters and the consistency report. Open the read-only Fuseki/ontology statistics. |
| 7:15–9:15 | ADMIN + NLP | Ask `List all the doctors`, then a French question such as `Quels sont les symptomes du diabete ?`. Point out language, intent, confidence, linked entities, generated SPARQL, explanation and result rows. Copy a query or hand it to the console. |
| 9:15–10:00 | ADMIN + closing | Open the SPARQL console and ontology graph. Run a read-only sample query, export results, and close by showing `/api/docs` and the role/scoping model. |

## Demo preparation

1. Configure the backend and Fuseki credentials without displaying them in the recording.
2. Start Fuseki, load the ontology, seed accounts, and start NLP, API and Angular.
3. Check `/api/status`, `/api/meta/health`, and `/api/docs` before the presentation.
4. Keep the admin console examples read-only. The API console has an explicit update mode; do not enable it during this walkthrough.
5. If a role account already exists, the seed script leaves it unchanged. Confirm its password before the demo rather than expecting a reseed to overwrite it.
