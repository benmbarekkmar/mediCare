# MedicCare

<p align="center">
  <strong>MedicCare — plateforme de démonstration pour la gestion des soins médicaux</strong><br />
  Dossiers, rendez-vous, données cliniques et recherche sémantique dans une application à plusieurs rôles.
</p>

<p align="center">
  <img alt="Angular 18" src="https://img.shields.io/badge/Angular-18-DD0031?logo=angular&amp;logoColor=white" />
  <img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&amp;logoColor=white" />
  <img alt="Express" src="https://img.shields.io/badge/Express-4-000000?logo=express&amp;logoColor=white" />
  <img alt="Python 3.11" src="https://img.shields.io/badge/Python-3.11-3776AB?logo=python&amp;logoColor=white" />
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-NLP-009688?logo=fastapi&amp;logoColor=white" />
  <img alt="Apache Jena Fuseki" src="https://img.shields.io/badge/Apache%20Jena-Fuseki-BD1E2D" />
  <img alt="Démonstration" src="https://img.shields.io/badge/Statut-D%C3%A9monstration-blue" />
</p>

---

## Sommaire

- [Présentation](#présentation)
- [Fonctionnalités](#fonctionnalités)
- [Rôles et autorisations](#rôles-et-autorisations)
- [Modules](#modules)
- [Technologies](#technologies)
- [Architecture et fonctionnement](#architecture-et-fonctionnement)
- [Structure du dépôt](#structure-du-dépôt)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Données et ontologie](#données-et-ontologie)
- [Lancement en local](#lancement-en-local)







## Présentation

**MedicCare** est une application web de démonstration consacrée à la gestion de données de santé structurées. Elle associe une interface Angular, une API REST Express, un graphe clinique RDF géré par Apache Jena Fuseki, une base SQLite pour les comptes et les traces d’audit, ainsi qu’un service NLP local.

L’application montre comment séparer les données de compte des données cliniques, appliquer des autorisations selon le rôle et interroger une ontologie médicale avec SPARQL. L’interface est disponible en français et en anglais. Le service NLP comprend les questions en anglais et en français, ainsi que des indices lexicaux arabes et tunisiens.

> **Usage pédagogique uniquement :** MedicCare n’est pas un dispositif médical, ne fournit pas de diagnostic et ne doit pas être utilisé avec de vraies données de patients.

## Fonctionnalités

- Consultation publique de maladies, symptômes, traitements, médicaments, hôpitaux, départements et médecins.
- Connexion, inscription, gestion de session JWT et profils par rôle.
- Portail patient avec dossier personnel, rendez-vous et demandes de rendez-vous.
- Espaces de travail pour les médecins et l’accueil, avec calendrier et accès aux dossiers autorisés.
- Administration des utilisateurs, consultation du journal d’audit et vérification de cohérence de l’ontologie.
- Exploration des individus de l’ontologie et console SPARQL réservée aux administrateurs.
- Assistant de recherche en langage naturel connecté aux données du graphe.
- Interface française et anglaise, avec traductions regroupées par fragments.
- API documentée avec OpenAPI et Swagger UI.

L’écran « mot de passe oublié » fournit une réponse uniforme afin de ne pas révéler si une adresse existe. **L’envoi de courriel n’est pas configuré** dans cette démonstration.

## Rôles et autorisations

Les rôles sont vérifiés côté serveur pour chaque requête. Les protections de routes Angular améliorent l’expérience utilisateur, mais ne remplacent pas les contrôles de l’API.

| Rôle | Accès principal |
|---|---|
| **ADMIN** | Administration des comptes et de l’audit, accès complet aux dossiers et outils d’ontologie, console SPARQL et assistant. |
| **DOCTOR** | Espace médecin et dossiers des patients suivis. Les données de référence restent accessibles en lecture seule. |
| **RECEPTIONIST** | Enregistrement des patients et gestion des rendez-vous. Les autres données cliniques sont en lecture seule selon les règles de l’API. |
| **PATIENT** | Portail personnel, dossier et rendez-vous propres au patient. |

L’API limite également les résultats liés aux patients selon l’identité du médecin ou du patient connecté.

## Modules

| Module | Description |
|---|---|
| Catalogue public | Recherche et consultation des médecins, hôpitaux, départements et ressources médicales. |
| Authentification | Inscription, connexion, renouvellement de session et contrôle d’accès par rôle. |
| Portail patient | Tableau de bord, dossier personnel, rendez-vous et demandes. |
| Espace du personnel | Vue de la journée, gestion des dossiers et calendrier partagé selon les permissions. |
| Dossiers cliniques | Consultation et gestion des patients, médecins, maladies, symptômes, traitements, médicaments, tests et rendez-vous. |
| Administration | Utilisateurs, journal d’audit, statistiques et cohérence des données dérivées. |
| Outils d’ontologie | Exploration du graphe, console SPARQL et assistant NLP. |
| Profil et préférences | Informations de profil, paramètres et langue de l’interface. |

## Technologies

- **Frontend :** Angular 18, TypeScript, RxJS, Angular Router et composants autonomes.
- **API :** Node.js 20+, Express 4 et TypeScript.
- **Authentification et comptes :** JWT, hachage des mots de passe avec bcrypt, SQLite et better-sqlite3.
- **Graphe clinique :** Apache Jena Fuseki, RDF, OWL, Turtle et SPARQL.
- **Service NLP :** Python 3.11, FastAPI, spaCy, scikit-learn, RDFLib et RapidFuzz.
- **Développement local :** npm, Docker Compose et Apache Jena Fuseki.
- **Déploiement de démonstration :** Blueprint Render décrit dans render.yaml.

Le service NLP fonctionne localement avec des modèles spaCy. **Il n’utilise pas d’API LLM externe.** L’utilisation d’embeddings est optionnelle et désactivée par défaut.

## Architecture et fonctionnement

~~~mermaid
flowchart LR
  Browser[Application Angular] -->|REST + JWT| API[API Express]
  API -->|comptes, sessions, audit| SQLite[(SQLite)]
  API -->|requêtes et mises à jour SPARQL| Fuseki[(Apache Jena Fuseki)]
  API -->|questions NLP| NLP[Service FastAPI]
  NLP -->|vocabulaire de l’ontologie| Fuseki
  Ontology[Fichiers OWL / Turtle] -->|chargement| Fuseki
~~~

Les données sont réparties selon leur usage :

- **Fuseki** contient les individus cliniques et leurs relations.
- **SQLite** contient les comptes, les empreintes des mots de passe, les jetons de renouvellement et le journal d’audit.
- **L’API Express** authentifie les requêtes, applique les permissions et interroge les services de données.
- **Le service NLP** analyse une question, identifie une intention et produit une requête SPARQL à partir de modèles contrôlés. L’API vérifie ensuite les droits avant d’exécuter la requête.
- **L’ontologie** est fournie sous forme de fichiers Turtle. L’application matérialise les types, relations inverses et autres liens dérivés nécessaires ; le jeu Fuseki utilisé ne repose pas sur un moteur de raisonnement.

### Parcours d’une question dans l’assistant

1. L’interface envoie la question à l’API avec la session de l’utilisateur.
2. L’API transmet la question au service Python et fournit l’identité du patient connecté lorsque cela est nécessaire.
3. Le service détecte la langue, reconnaît les termes de l’ontologie, sélectionne une intention et construit une requête SPARQL en lecture seule.
4. L’API applique le périmètre d’accès du rôle puis renvoie les résultats et leur explication à l’interface.

## Structure du dépôt

~~~text
.
├── backend/
│   ├── nlp-service/       # Service NLP Python/FastAPI et tests
│   ├── ontology/          # Ontologie MedicCare en Turtle
│   ├── scripts/           # Chargement, seed et commandes NLP
│   ├── src/               # API Express, authentification et services métier
│   └── tests/             # Tests API et intégration
├── frontend/
│   ├── e2e/               # Scénarios Playwright
│   ├── public/i18n/        # Traductions françaises et anglaises
│   └── src/app/           # Pages, services, navigation et composants UI
├── docs/                   # Notes d’évaluation NLP et exemples SPARQL
├── infra/fuseki/           # Image et démarrage Fuseki pour Render
├── docker-compose.yml      # Fuseki local et graphes medicare / medicare_test
├── render.yaml             # Services Render
└── package.json            # Commandes communes du projet
~~~

## Prérequis

- Git.
- Node.js **20 ou supérieur** et npm.
- Python **3.11**.
- Docker avec le plugin Compose, ou une instance locale Apache Jena Fuseki.
- Les modèles spaCy anglais et français si le service NLP doit être exécuté :
  - en_core_web_md
  - fr_core_news_md

Les modèles sentence-transformers ne sont nécessaires que si la recherche par embeddings est activée.

## Installation

### 1. Cloner le dépôt et installer les dépendances JavaScript

~~~bash
git clone https://github.com/benmbarekkmar/mediCare.git
cd mediCare

npm --prefix backend ci
npm --prefix frontend ci
~~~

### 2. Créer l’environnement Python du service NLP

**Windows — PowerShell :**

~~~powershell
py -3.11 -m venv backend/nlp-service/.venv
backend/nlp-service/.venv/Scripts/python.exe -m pip install --upgrade pip
backend/nlp-service/.venv/Scripts/python.exe -m pip install -r backend/nlp-service/requirements.txt
backend/nlp-service/.venv/Scripts/python.exe -m spacy download en_core_web_md
backend/nlp-service/.venv/Scripts/python.exe -m spacy download fr_core_news_md
~~~

**Linux ou macOS :**

~~~bash
python3.11 -m venv backend/nlp-service/.venv
backend/nlp-service/.venv/bin/python -m pip install --upgrade pip
backend/nlp-service/.venv/bin/python -m pip install -r backend/nlp-service/requirements.txt
backend/nlp-service/.venv/bin/python -m spacy download en_core_web_md
backend/nlp-service/.venv/bin/python -m spacy download fr_core_news_md
~~~

Le script npm run nlp utilise directement cet environnement virtuel. Il n’est donc pas nécessaire de l’activer avant de lancer le service.

## Configuration

Créer le fichier de configuration du backend :

**PowerShell :**

~~~powershell
Copy-Item backend/.env.example backend/.env
~~~

**Linux ou macOS :**

~~~bash
cp backend/.env.example backend/.env
~~~

Adapter ensuite les valeurs de backend/.env. Pour Docker Compose, la variable FUSEKI_ADMIN_PASSWORD est lue depuis le fichier .env **à la racine** du dépôt. En développement, sa valeur doit correspondre à FUSEKI_PASSWORD dans backend/.env.

~~~dotenv
# Fichier .env à la racine, utilisé par Docker Compose
FUSEKI_ADMIN_PASSWORD=remplacer-par-un-secret-local

# backend/.env — adapter également ces valeurs
FUSEKI_USER=admin
FUSEKI_PASSWORD=remplacer-par-le-meme-secret
FUSEKI_BASE_URL=http://localhost:3030
FUSEKI_DATASET=medicare
~~~

Ne commitez aucun de ces fichiers. Le dépôt ignore les fichiers .env, les bases SQLite, les dépendances et les artefacts de compilation.



## Données et ontologie

Fuseki doit être démarré avant le chargement de l’ontologie. À la racine du dépôt :

~~~bash
npm run infra
npm run ontology
npm run seed
~~~

- npm run infra démarre Fuseki avec les jeux medicare et medicare_test.
- npm run ontology charge backend/ontology/MedicCare_final_fuseki_en.ttl dans le jeu défini par FUSEKI_DATASET.
- npm run seed crée les comptes de démonstration dans SQLite. Le script vérifie que les patients et médecins associés existent déjà dans l’ontologie.

> **Attention :** par défaut, npm run ontology vide le graphe sélectionné avant de le recharger. Ne lancez pas cette commande contre un jeu contenant des données à conserver. L’option --append existe pour ajouter les données sans effacer le graphe.

Les données de test doivent rester séparées des données de démonstration. Le jeu medicare_test est prévu pour les tests d’intégration, qui peuvent le vider et le remplir.

Pour utiliser une instance Fuseki locale au lieu de Docker, démarrer un jeu avec les mises à jour activées, par exemple :

~~~bash
fuseki-server --update --mem /medicare
~~~

Configurer ensuite FUSEKI_BASE_URL, FUSEKI_DATASET, FUSEKI_USER et FUSEKI_PASSWORD en conséquence.

## Lancement en local

Après l’installation, la configuration, le démarrage de Fuseki, le chargement de l’ontologie et la création des comptes, lancer chaque service dans un terminal distinct, depuis la racine du dépôt.

**Terminal 1 — service NLP :**

~~~bash
npm run nlp
~~~

**Terminal 2 — API Express :**

~~~bash
npm run api
~~~

**Terminal 3 — application Angular :**

~~~bash
npm run web
~~~

| Service | Adresse locale |
|---|---|
| Application web | [http://localhost:4300](http://localhost:4300) |
| API REST | [http://localhost:4000/api](http://localhost:4000/api) |
| Documentation Swagger | [http://localhost:4000/api/docs](http://localhost:4000/api/docs) |
| Document OpenAPI | [http://localhost:4000/api/openapi.json](http://localhost:4000/api/openapi.json) |
| État de l’API et du graphe | [http://localhost:4000/api/status](http://localhost:4000/api/status) |
| Santé du service NLP | [http://localhost:8100/health](http://localhost:8100/health) |
| Interface Fuseki | [http://localhost:3030](http://localhost:3030) |

En mode développement, Angular et l’API tournent séparément. Dans la configuration de production, l’API sert aussi les fichiers compilés du frontend.

