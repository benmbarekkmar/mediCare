# SPARQL examples

These examples use the real namespace and vocabulary from `MedicCare_final_fuseki_en.ttl`. Run reads at `/medicare/query`. The write examples are for a disposable dataset or a temporary test graph only; they mutate data. API CRUD should normally be used for writes because the ontology writer applies validation and materialization rules.

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
```

Prefix declarations are included with each example so each block can be copied independently.

## Read queries

### 1. List doctors

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?doctor ?name WHERE { ?doctor rdf:type :Doctor ; rdfs:label ?name }
ORDER BY ?name LIMIT 100
```

### 2. List patients and ages

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?patient ?name ?age WHERE { ?patient rdf:type :Patient ; rdfs:label ?name ; :hasAge ?age }
ORDER BY DESC(?age) LIMIT 100
```

### 3. Patients older than 40

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?name ?age WHERE { ?p rdf:type :Patient ; rdfs:label ?name ; :hasAge ?age . FILTER(?age > 40) }
ORDER BY DESC(?age) LIMIT 100
```

### 4. Patients with blood type O+

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?name WHERE { ?p :hasBloodType "O+" ; rdfs:label ?name }
ORDER BY ?name LIMIT 100
```

### 5. Count patients by gender

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
SELECT ?gender (COUNT(?p) AS ?patients) WHERE { ?p :hasGender ?gender }
GROUP BY ?gender ORDER BY ?gender
```

### 6. Count appointments by status

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
SELECT ?status (COUNT(?a) AS ?appointments) WHERE { ?a :appointmentStatus ?status }
GROUP BY ?status ORDER BY ?status
```

### 7. Pending appointments

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?appointment ?date ?label WHERE {
  ?appointment :appointmentStatus "Pending" ; :appointmentDate ?date ; rdfs:label ?label
}
ORDER BY ?date LIMIT 100
```

### 8. Appointments in November 2026

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?appointment ?date WHERE {
  ?appointment :appointmentDate ?date .
  FILTER(?date >= "2026-11-01T00:00:00"^^xsd:dateTime && ?date < "2026-12-01T00:00:00"^^xsd:dateTime)
}
ORDER BY ?date LIMIT 100
```

### 9. Tests with their date and result

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?test ?label ?date ?result WHERE {
  ?test a :MedicalTest ; rdfs:label ?label ; :testDate ?date ; :testResult ?result
}
ORDER BY DESC(?date) LIMIT 100
```

### 10. Tests with a normal result

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?label ?result WHERE {
  ?test a :MedicalTest ; rdfs:label ?label ; :testResult ?result .
  FILTER(CONTAINS(LCASE(STR(?result)), "normal"))
}
LIMIT 100
```

### 11. Symptoms of diabetes

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?symptom ?name WHERE {
  :Diabetes :hasSymptom ?symptom . ?symptom rdfs:label ?name
}
ORDER BY ?name LIMIT 100
```

### 12. Treatments for diabetes

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?treatment ?name WHERE {
  :Diabetes :hasTreatment ?treatment . ?treatment rdfs:label ?name
}
ORDER BY ?name LIMIT 100
```

### 13. Medications used by diabetes treatments

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?medication ?name ?dose WHERE {
  :Diabetes :hasTreatment/:usesMedication ?medication .
  ?medication rdfs:label ?name ; :medicationDosage ?dose
}
ORDER BY ?name LIMIT 100
```

### 14. Patients diagnosed with diabetes

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?patient ?name WHERE { ?patient :hasDisease :Diabetes ; rdfs:label ?name }
ORDER BY ?name LIMIT 100
```

### 15. Doctors and their departments

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?doctorName ?departmentName WHERE {
  ?doctor a :Doctor ; rdfs:label ?doctorName ; :worksIn ?department .
  ?department rdfs:label ?departmentName
}
ORDER BY ?doctorName LIMIT 100
```

### 16. Departments and hospitals

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?departmentName ?hospitalName WHERE {
  ?department a :MedicalDepartment ; rdfs:label ?departmentName ; :locatedIn ?hospital .
  ?hospital rdfs:label ?hospitalName
}
ORDER BY ?hospitalName ?departmentName LIMIT 100
```

### 17. Patients followed by a doctor

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?patientName WHERE {
  ?patient :treatedBy :Doctor_Salma ; rdfs:label ?patientName
}
ORDER BY ?patientName LIMIT 100
```

### 18. Doctors with no patients

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?doctor ?name WHERE {
  ?doctor rdf:type :Doctor ; rdfs:label ?name .
  FILTER NOT EXISTS { ?patient :treatedBy ?doctor }
}
ORDER BY ?name LIMIT 100
```

### 19. Search labels for a word

```sparql
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?term ?label WHERE {
  ?term rdfs:label ?label . FILTER(CONTAINS(LCASE(STR(?label)), "cardio"))
}
ORDER BY ?label LIMIT 100
```

### 20. Count individuals by class

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT ?class (COUNT(DISTINCT ?individual) AS ?total) WHERE {
  ?individual rdf:type ?class, owl:NamedIndividual .
  ?class rdf:type owl:Class
}
GROUP BY ?class ORDER BY DESC(?total)
```

### 21. Classes below Patient

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?class WHERE { ?class rdfs:subClassOf+ :Patient }
ORDER BY ?class LIMIT 100
```

### 22. Ask whether Ahmed has diabetes

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
ASK { :Patient_Ahmed :hasDisease :Diabetes }
```

### 23. Construct a small diabetes neighborhood

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
CONSTRUCT { :Diabetes ?predicate ?object }
WHERE { :Diabetes ?predicate ?object }
```

## Write examples for a disposable dataset

### 24. Insert a temporary symptom individual

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
INSERT DATA {
  :Symptom_DocExample rdf:type :Symptom, owl:NamedIndividual ;
    rdfs:label "Documentation example symptom"@en ;
    :symptomName "Documentation example symptom" .
}
```

### 25. Change the temporary symptom label

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
DELETE { :Symptom_DocExample rdfs:label "Documentation example symptom"@en }
INSERT { :Symptom_DocExample rdfs:label "Updated documentation example"@en }
WHERE  { :Symptom_DocExample rdfs:label "Documentation example symptom"@en }
```

### 26. Delete the temporary symptom's outgoing triples

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
DELETE WHERE { :Symptom_DocExample ?predicate ?object }
```

### 27. Remove all triples that mention the temporary IRI

```sparql
PREFIX : <http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#>
DELETE { ?subject ?predicate ?object }
WHERE {
  VALUES ?target { :Symptom_DocExample }
  ?subject ?predicate ?object .
  FILTER(?subject = ?target || ?object = ?target)
}
```

Examples 24–27 demonstrate raw SPARQL syntax only. They do not implement the project's validation, inverse-link maintenance or derived-class rules; use the API ontology writer for application writes.
