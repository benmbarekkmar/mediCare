# NLP evaluation

## Evaluation method

The bundled evaluation set in `backend/nlp-service/app/evaluation.py` contains **137 English and French questions across all 48 registered intents**. Each case declares its expected intent and expected result shape (row count, value, match or ASK truth). `npm run nlp:evaluate` runs the complete evaluation against the configured Fuseki dataset. The accuracy target is 90%.

The pytest suite also has a store-independent routing check for every case. That check verifies the expected intent, any declared language, and a generated SPARQL query. Store-dependent checks execute the query and compare its results against the expected demo data.

## Fuseki-backed measured run

On 2026-10-29, the evaluation ran against the isolated `medicare_test` Fuseki dataset after loading the bundled Turtle graph. The loader reported 1,619 triples and a clean materialization audit (16 checks, 0 violations). The command was `npm run nlp:evaluate` with `FUSEKI_DATASET=medicare_test`.

```text
137 cases, 48 intents covered, accuracy 100.0%
TARGET 90% MET
```

All expected query results, values, row counts, match checks, and ASK truths passed. Per-intent results:

| Intent | Correct / cases | Accuracy |
| --- | ---: | ---: |
| appointments_by_date | 3 / 3 | 100% |
| appointments_by_department | 1 / 1 | 100% |
| appointments_by_status | 5 / 5 | 100% |
| appointments_by_type | 2 / 2 | 100% |
| ask_boolean | 5 / 5 | 100% |
| chronic_patients | 1 / 1 | 100% |
| count_instances | 6 / 6 | 100% |
| department_doctors | 3 / 3 | 100% |
| department_hospital | 2 / 2 | 100% |
| departments_by_type | 2 / 2 | 100% |
| describe_individual | 3 / 3 | 100% |
| disease_description | 3 / 3 | 100% |
| disease_medications | 4 / 4 | 100% |
| disease_patients | 3 / 3 | 100% |
| disease_symptoms | 5 / 5 | 100% |
| disease_treatments | 3 / 3 | 100% |
| doctor_department | 2 / 2 | 100% |
| doctor_hospital | 2 / 2 | 100% |
| doctor_patients | 2 / 2 | 100% |
| doctors_by_specialty | 4 / 4 | 100% |
| doctors_without_patients | 2 / 2 | 100% |
| emergency_patients | 1 / 1 | 100% |
| followed_in_hospital | 2 / 2 | 100% |
| hospital_departments | 2 / 2 | 100% |
| hospital_doctors | 2 / 2 | 100% |
| hospitals_by_department_type | 4 / 4 | 100% |
| hospitals_by_type | 2 / 2 | 100% |
| list_instances | 6 / 6 | 100% |
| medication_dosage | 4 / 4 | 100% |
| medications_by_class | 4 / 4 | 100% |
| patient_appointments | 2 / 2 | 100% |
| patient_diseases | 3 / 3 | 100% |
| patient_doctor | 3 / 3 | 100% |
| patient_tests | 2 / 2 | 100% |
| patients_by_age_comparator | 5 / 5 | 100% |
| patients_by_age_group | 3 / 3 | 100% |
| patients_by_blood_type | 2 / 2 | 100% |
| patients_by_gender | 2 / 2 | 100% |
| patients_per_doctor | 2 / 2 | 100% |
| search_by_keyword | 5 / 5 | 100% |
| symptom_diseases | 3 / 3 | 100% |
| tests_by_result | 2 / 2 | 100% |
| tests_by_type | 3 / 3 | 100% |
| top_diseases_by_patients | 2 / 2 | 100% |
| top_medications_by_diseases | 2 / 2 | 100% |
| treatment_duration | 2 / 2 | 100% |
| treatment_medications | 2 / 2 | 100% |
| upcoming_appointments | 2 / 2 | 100% |

With the same test dataset loaded, `npm run nlp:test` also passed all **292 tests**. Pytest reported two upstream deprecation warnings from spaCy/Click and scikit-learn/SciPy; there were no failures or skips.

## Earlier offline routing run

On 2026-10-29, after adding the bundled-Turtle vocabulary fallback, `npm run nlp:test` reported:

```text
154 passed, 138 skipped
```

All 137 case-routing checks passed, covering 48/48 registered intents. The 138 skipped cases are the 137 result-shape checks plus the overall accuracy gate; their module-scoped fixture skips them when Fuseki cannot be reached. This is a measured **100% routing pass rate** on the bundled questions, not a measured end-to-end answer accuracy.

At the time of this offline run, Fuseki was unavailable, so this specific run measured routing only. The Fuseki-backed results above supersede this historical note.


## Example translations

**Question:** `List all the doctors`  
**Intent:** `list_instances`  
**Generated query shape:** a read-only `SELECT` for individuals typed as `:Doctor`, returning their IRI and label with a bounded `LIMIT`.

**Question:** `Quels sont les symptomes du diabete ?`  
**Intent:** `disease_symptoms`  
**Generated query shape:** resolve the Diabetes individual, follow `:hasSymptom`, and return the symptom IRI and label.

**Question:** `How many appointments are pending?`  
**Intent:** `appointments_by_status`  
**Generated query shape:** select appointment individuals with `:appointmentStatus "Pending"` and count them.

The concrete SPARQL examples in [sparql-examples.md](sparql-examples.md) show the ontology vocabulary and query forms. All generated NLP queries are read-only; graph mutations use the API's ontology writer instead.

## Limits

- The test questions are a project-specific evaluation set, not an independent clinical language benchmark.
- The target values in the evaluation cases describe the bundled demo graph and should be revised if that data changes.
- Intent routing verifies translation and template generation, not that Fuseki contains the expected data or that every result is clinically complete.
- The optional embedding backend is disabled by default; the measured test run used the standard local classifier and rules.
