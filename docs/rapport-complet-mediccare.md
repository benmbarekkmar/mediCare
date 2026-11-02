# Rapport synthétique de MedicCare

## 1. Présentation

**MedicCare** est une application web de gestion médicale et de recherche
dans une base de connaissances médicales. Elle permet de gérer les patients,
médecins, rendez-vous, hôpitaux, départements, maladies, symptômes,
traitements, médicaments et examens.

L'application contient aussi un assistant intelligent capable de comprendre une
question en langage naturel et de rechercher une réponse dans le graphe
médical. Les données utilisées sont des données de démonstration : l'application
ne remplace pas un professionnel de santé.

---

## 2. Architecture de l'application

```text
Navigateur
   ↓
Frontend Angular
   ↓ HTTP REST + JWT
Backend Express / TypeScript
   ├── SQLite : comptes, sessions et audit
   ├── Apache Jena Fuseki : graphe RDF/OWL
   └── Service NLP Python / FastAPI
            ↓
       Analyse du langage et génération SPARQL
```

### Composants principaux

| Composant | Rôle |
|---|---|
| Angular 18 | Interfaces, tableaux, formulaires, calendrier et dashboards |
| Express + TypeScript | API REST, sécurité, CRUD et règles métier |
| SQLite | Comptes utilisateurs, sessions et journal d'audit |
| Apache Jena Fuseki | Stockage et interrogation du graphe médical |
| RDF | Représentation des faits et relations |
| OWL | Classes, propriétés et règles de l'ontologie |
| SPARQL | Recherche et mise à jour du graphe |
| Python + FastAPI | Microservice de traitement du langage |
| spaCy | Tokenisation, analyse linguistique et reconnaissance d'entités |
| Docker Compose | Lancement des services de l'application |

---

## 3. Notions essentielles

### RDF et OWL

RDF représente une information sous forme de triplet :

```text
Diabète — possède comme symptôme — Fatigue
```

OWL définit le sens des éléments et des relations : un médecin est une
personne, un département appartient à un hôpital et un traitement peut être
lié à une maladie.

### Fuseki

Fuseki est le serveur qui contient le graphe RDF/OWL. Il joue un rôle
comparable à une base de données, mais il stocke surtout des relations entre
concepts.

### SPARQL

SPARQL est le langage utilisé pour rechercher dans le graphe. Exemple :

```sparql
SELECT ?symptom ?label
WHERE {
  medicare:Diabetes medicare:hasSymptom ?symptom .
  ?symptom medicare:label ?label .
}
```

Cette requête demande les symptômes liés au diabète.

### NLP et spaCy

Le NLP permet à l'application de comprendre une phrase humaine. spaCy aide à
identifier les mots, les entités médicales et la structure de la phrase.
L'application prend en charge principalement le français et l'anglais, avec
des formes arabes et tunisiennes/Derja prévues dans le lexique.

---

## 4. Fonctionnement général

1. L'utilisateur se connecte.
2. Le frontend envoie les demandes à l'API avec un token JWT.
3. L'API vérifie le rôle et les permissions.
4. Les données administratives sont lues ou enregistrées dans SQLite.
5. Les données médicales sont recherchées dans Fuseki avec SPARQL.
6. Les actions importantes sont enregistrées dans l'audit.
7. Le résultat est retourné au frontend et affiché dans un tableau, une fiche,
   un calendrier ou un dashboard.

### Fonctionnement de l'assistant intelligent

```text
Question utilisateur
   ↓
Détection de la langue
   ↓
Normalisation du texte
   ↓
Extraction des entités médicales
   ↓
Détection de l'intention
   ↓
Construction d'une requête SPARQL contrôlée
   ↓
Validation par l'API
   ↓
Exécution dans Fuseki
   ↓
Réponse compréhensible
```

Exemple :

```text
Question : Quels sont les symptômes du diabète ?
Entité   : Diabetes
Intention: rechercher les symptômes
Relation : hasSymptom
Résultat : liste des symptômes trouvés dans Fuseki
```

Le texte utilisateur n'est pas concaténé directement dans SPARQL. Les
requêtes sont construites à partir de modèles contrôlés, limitées à la lecture
pour l'assistant et vérifiées par l'API.

---

## 5. Sécurité et rôles

- **JWT** : authentification des utilisateurs.
- **RBAC** : permissions différentes selon le rôle.
- **Validation** : contrôle des paramètres et des données reçues.
- **Audit** : traçabilité des actions importantes.
- **Protection des données** : un patient ne peut consulter que ses données.
- **Séparation des responsabilités** : le NLP comprend la question, mais
  l'API décide si l'opération est autorisée.

### Rôles

| Rôle | Responsabilité principale |
|---|---|
| Administrateur | Gérer les comptes, les données, les permissions et l'audit |
| Réceptionniste | Gérer les patients, rendez-vous et confirmations |
| Médecin | Consulter ses patients, rendez-vous et examens |
| Patient | Consulter son dossier et demander un rendez-vous |

---

## 6. Commandes pour lancer l'application

### Installation initiale

Depuis la racine du projet :

```powershell
git clone https://github.com/benmbarekkmar/mediCare.git
cd mediCare
npm --prefix backend ci
npm --prefix frontend ci
py -3.11 -m venv backend/nlp-service/.venv
backend/nlp-service/.venv/Scripts/python.exe -m pip install -r backend/nlp-service/requirements.txt
backend/nlp-service/.venv/Scripts/python.exe -m spacy download en_core_web_md
backend/nlp-service/.venv/Scripts/python.exe -m spacy download fr_core_news_md
Copy-Item backend/.env.example backend/.env
```

Configurer ensuite `backend/.env` avec les paramètres Fuseki. Ne pas
committer les fichiers `.env`.

### Démarrage des données et des services

```powershell
npm run infra       # démarre Fuseki dans Docker
npm run ontology    # charge l'ontologie Turtle dans Fuseki
npm run seed        # crée les comptes de démonstration
```

Lancer ensuite ces commandes dans **trois terminaux séparés** :

```powershell
npm run nlp         # service NLP FastAPI, port 8100
npm run api         # API Express, port 4000
npm run web         # frontend Angular, port 4300
```

Adresses utiles :

```text
Frontend : http://localhost:4300
API      : http://localhost:4000/api
Swagger  : http://localhost:4000/api/docs
Fuseki   : http://localhost:3030
NLP      : http://localhost:8100/health
```

### Vérification, tests et arrêt

```powershell
npm run build       # compile le backend et le frontend
npm run test:api    # tests d'intégration et unitaires API
npm run test:nlp    # tests du service NLP
npm run test:web    # tests Angular
npm run lint        # vérification du code
npm run infra:down  # arrête Fuseki
```

## 7. Scénario de démonstration complet

### Étape 1 — Connexion

Présenter la page de connexion et montrer que l'interface et les menus
changent selon le rôle connecté.

### Étape 2 — Démonstration Administrateur

1. Ouvrir le dashboard et présenter les statistiques.
2. Ouvrir la liste des utilisateurs.
3. Créer ou modifier un compte.
4. Ouvrir la liste des hôpitaux et afficher les départements et les médecins
   associés.
5. Ouvrir la page d'audit pour montrer la traçabilité des actions.

**Message à expliquer :** l'administrateur contrôle la structure et la sécurité
de l'application.

### Étape 3 — Démonstration Réceptionniste

1. Ouvrir le dashboard de réception.
2. Montrer les rendez-vous du jour.
3. Parcourir la liste des demandes en attente avec la pagination.
4. Confirmer une demande, puis montrer la mise à jour du statut.
5. Afficher les cinq premiers médecins et départements.
6. Cliquer sur **Voir tout** pour ouvrir les listes complètes.
7. Créer un nouveau patient ou un nouveau rendez-vous.

**Message à expliquer :** la réception organise les rendez-vous et répond aux
demandes des patients.

### Étape 4 — Démonstration Médecin

1. Ouvrir le dashboard médecin.
2. Montrer les rendez-vous du jour et de la semaine.
3. Ouvrir la fiche d'un patient suivi.
4. Consulter ou ajouter un examen.
5. Vérifier qu'un médecin ne voit que les données autorisées par son périmètre.

**Message à expliquer :** le médecin travaille sur les patients et les
examens qui lui sont associés.

### Étape 5 — Démonstration Patient

1. Ouvrir le dossier médical.
2. Consulter les maladies, traitements et examens.
3. Ouvrir **Demander un rendez-vous**.
4. Rechercher un département.
5. Choisir un médecin, une date et un créneau.
6. Confirmer la demande.
7. Ouvrir la liste des rendez-vous pour voir son statut.

**Message à expliquer :** le patient consulte ses propres informations et crée
une demande qui doit être confirmée par la réception.

### Étape 6 — Démonstration du traducteur intelligent

Dans l'assistant, saisir :

```text
Quels sont les symptômes du diabète ?
```

Montrer successivement :

1. l'intention détectée ;
2. l'entité `Diabetes` reconnue ;
3. la requête SPARQL générée ;
4. l'exécution dans Fuseki ;
5. la réponse finale affichée en langage naturel.

Terminer avec une deuxième question, par exemple :

```text
Quels médecins travaillent dans le service de cardiologie ?
```

---

## 8. Conclusion

MedicCare combine une application de gestion médicale classique avec un
graphe de connaissances. Angular fournit l'interface, Express protège et
oriente les opérations, SQLite conserve les données de sécurité, Fuseki
interroge les connaissances médicales et le service NLP transforme les
questions humaines en recherches SPARQL contrôlées.

Le meilleur ordre pour une démonstration est :

```text
Connexion → Dashboard → Gestion des données → Rendez-vous
→ Assistant intelligent → Vérification des permissions
```
