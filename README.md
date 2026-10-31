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
- [API](#api)
- [Tests et qualité](#tests-et-qualité)
- [Comptes de démonstration](#comptes-de-démonstration)
- [Déploiement sur Render](#déploiement-sur-render)
- [Sécurité et limites](#sécurité-et-limites)
- [Dépannage](#dépannage)
- [Documentation complémentaire](#documentation-complémentaire)

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

### Variables principales

| Variable | Fichier | Rôle |
|---|---|---|
| NODE_ENV, PORT | backend/.env | Mode et port de l’API ; le port local par défaut est 4000. |
| CORS_ORIGINS | backend/.env | Origines navigateur autorisées ; en local, http://localhost:4300. |
| FUSEKI_BASE_URL, FUSEKI_DATASET | backend et service NLP | Adresse de Fuseki et nom du graphe utilisé, généralement medicare. |
| FUSEKI_USER, FUSEKI_PASSWORD | backend/.env | Identifiants de connexion du backend à Fuseki. |
| FUSEKI_ADMIN_PASSWORD | .env racine / Render | Mot de passe administrateur donné au conteneur Fuseki. |
| JWT_SECRET | backend/.env | Secret de signature des sessions ; utiliser une valeur longue, aléatoire et privée. |
| JWT_ACCESS_TTL_MINUTES, JWT_REFRESH_TTL_DAYS | backend/.env | Durée de vie des jetons d’accès et de renouvellement. |
| SQLITE_FILE | backend/.env | Emplacement de la base SQLite ; par défaut ./data/app.db. |
| NLP_SERVICE_URL, NLP_TIMEOUT_MS | backend/.env | Adresse et délai d’attente du service NLP ; par défaut http://localhost:8100. |
| SEED_DEMO_PASSWORD | backend/.env | Mot de passe attribué aux comptes créés par la commande seed. Il n’est jamais affiché par le script. |
| SPACY_MODEL_SIZE | service NLP | Taille des modèles spaCy ; md par défaut, sm dans la configuration Render. |
| USE_EMBEDDINGS, EMBEDDING_MODEL, NLP_MIN_CONFIDENCE | service NLP | Réglages optionnels de recherche et seuil de confiance. |

La liste complète des valeurs locales figure dans [backend/.env.example](backend/.env.example). En production, remplacer toutes les valeurs de développement par des secrets privés. Si USE_EMBEDDINGS=true, installer également sentence-transformers dans l’environnement Python du service NLP.

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

## API

La documentation interactive est disponible à /api/docs et le document OpenAPI brut à /api/openapi.json.

Les principaux groupes de routes sont :

- /api/auth, /api/users, /api/permissions et /api/audit : comptes, sessions et audit.
- /api/public : catalogues publics.
- /api/patients, /api/doctors, /api/diseases, /api/symptoms, /api/treatments, /api/medications, /api/tests, /api/appointments, /api/hospitals et /api/departments : données cliniques.
- /api/search et /api/dashboard : recherche et indicateurs.
- /api/ontology et /api/consistency : exploration et cohérence du graphe.
- /api/nlp : assistant et traduction en requêtes.
- /api/console et /api/sparql : outils SPARQL réservés selon le rôle.
- /api/status : état de l’API et connexion à Fuseki.

Les contrôles de droits sont appliqués par l’API, indépendamment de l’interface Angular.

## Tests et qualité

Depuis la racine du dépôt :

~~~bash
npm run build
npm run test:api
npm run test:web
npm run test:nlp
npm run lint
npm --prefix frontend run check-i18n
~~~

- npm run build compile l’API TypeScript et le frontend Angular.
- npm run test:api exécute les tests API et d’intégration.
- npm run test:web exécute les tests Angular avec Chrome Headless.
- npm run test:nlp exécute les tests Python du service NLP.
- npm run lint lance ESLint sur les projets backend et frontend.
- npm --prefix frontend run check-i18n vérifie les traductions française et anglaise.

### Tests de bout en bout

Les scénarios Playwright nécessitent Fuseki, le service NLP, l’API et l’application web en marche. Utiliser un jeu de test isolé :

1. Dans backend/.env, définir FUSEKI_DATASET=medicare_test, un fichier SQLite de test et un mot de passe de démonstration privé.
2. Démarrer Fuseki avec npm run infra, puis charger l’ontologie et les comptes dans ce jeu avec npm run ontology et npm run seed.
3. Démarrer npm run nlp, npm run api et npm run web.
4. Définir E2E_DEMO_PASSWORD avec la même valeur que SEED_DEMO_PASSWORD, puis lancer :

~~~bash
npm run test:e2e
~~~

Les tests vérifient que l’API cible bien un jeu dont le nom se termine par _test avant d’effectuer des écritures. Le serveur Playwright utilise Chrome installé sur la machine. Les détails de configuration sont dans [frontend/playwright.config.ts](frontend/playwright.config.ts).

L’évaluation NLP documentée se trouve dans [docs/nlp-evaluation.md](docs/nlp-evaluation.md). Elle décrit le jeu de questions de démonstration, la mesure sur Fuseki et les limites de cette mesure.

## Comptes de démonstration

npm run seed crée les comptes suivants. Le mot de passe initial est la valeur privée définie dans SEED_DEMO_PASSWORD au moment de leur création.

| Adresse | Rôle | Exemple d’usage |
|---|---|---|
| admin@medicare.tn | ADMIN | Interface française, administration et outils. |
| nour.elamri@medicare.tn | ADMIN | Exemple d’interface anglaise. |
| reception@medicare.tn | RECEPTIONIST | Enregistrement des patients et rendez-vous. |
| salma.benali@medicare.tn | DOCTOR | Espace médecin avec périmètre patient associé. |
| hatem.trabelsi@medicare.tn | DOCTOR | Deuxième compte médecin pour comparer les périmètres. |
| ahmed@medicare.tn | PATIENT | Portail patient et dossier personnel. |
| sara@medicare.tn | PATIENT | Deuxième compte patient de démonstration. |

Le script n’écrase pas les comptes existants. Si un compte existe déjà, une nouvelle valeur de SEED_DEMO_PASSWORD ne changera pas son mot de passe.

## Déploiement sur Render

Le Blueprint [render.yaml](render.yaml) décrit trois services :

1. **API Node.js** : compile l’API et Angular, puis sert l’interface web et les routes /api depuis la même adresse.
2. **Fuseki** : héberge le graphe RDF.
3. **Service NLP Python** : exécute FastAPI avec les modèles spaCy plus petits adaptés à cette configuration.

Pour déployer, pousser le dépôt vers GitHub, puis choisir **New → Blueprint** dans Render et connecter le dépôt.

Après le premier déploiement :

1. Définir une valeur privée pour SEED_DEMO_PASSWORD dans l’environnement du service API.
2. Dans un shell du service API, ou un environnement d’administration configuré avec les variables des services, exécuter :

~~~bash
npm --prefix backend run render:init
~~~

Cette commande attend Fuseki, charge l’ontologie si le graphe est vide et crée les comptes de démonstration. Si le service NLP a démarré avant le chargement des données, le redémarrer pour qu’il recharge le vocabulaire depuis Fuseki.

La configuration Render actuelle est destinée à une démonstration :

- SQLite est configuré en mémoire (SQLITE_FILE=:memory:).
- Aucun disque persistant n’est déclaré pour le service Fuseki.
- Les comptes, les journaux, les modifications du graphe et les autres données peuvent donc être perdus lors d’un redémarrage ou d’un redéploiement.
- Ne pas y enregistrer de vraies données médicales. Pour conserver des données, configurer des services et un stockage persistants avant tout usage autre qu’une démonstration.

## Sécurité et limites

- MedicCare est une démonstration logicielle, pas un outil de diagnostic ni un dossier médical certifié.
- Utiliser uniquement des données synthétiques ou non sensibles.
- Remplacer JWT_SECRET, les mots de passe Fuseki et SEED_DEMO_PASSWORD avant toute exposition publique.
- Ne jamais commiter .env, les clés, les mots de passe ou les bases locales.
- Les mots de passe des comptes sont hachés dans SQLite ; le service conserve aussi les jetons de renouvellement et les traces d’audit.
- Les contrôles de rôles doivent rester côté serveur ; ne pas se fier uniquement à l’affichage conditionnel dans le frontend.
- L’assistant NLP sert à interroger les données structurées. Il ne remplace ni un professionnel de santé ni une évaluation clinique.
- La récupération de mot de passe n’envoie pas de courriel dans la configuration actuelle.

## Dépannage

| Problème | Vérifications |
|---|---|
| Fuseki ne répond pas | Vérifier Docker, docker compose ps, docker compose logs fuseki, l’URL de base, le jeu et l’alignement entre FUSEKI_ADMIN_PASSWORD et FUSEKI_PASSWORD. |
| Le catalogue ou les tableaux de bord sont vides | Vérifier FUSEKI_DATASET, puis charger l’ontologie dans le jeu voulu. Le chargement par défaut efface d’abord ce jeu. |
| Le seed refuse un compte médecin ou patient | Charger l’ontologie avant npm run seed ; chaque compte lié doit correspondre à un individu existant. |
| Le service NLP ne démarre pas | Vérifier Python 3.11, l’environnement backend/nlp-service/.venv et les deux modèles spaCy. |
| Le NLP ne trouve pas de termes | Vérifier la connexion du service NLP à Fuseki et la présence de l’ontologie, puis redémarrer le service NLP ou recharger son vocabulaire. |
| Le frontend ne peut pas appeler l’API | Vérifier CORS_ORIGINS, l’URL de l’API configurée et que le backend écoute sur le port attendu. |
| Le mot de passe de démonstration ne fonctionne pas | Vérifier la valeur utilisée à la première création du compte ; le seed laisse les comptes existants inchangés. |

## Documentation complémentaire

- [backend/.env.example](backend/.env.example) — variables d’environnement locales.
- [docs/nlp-evaluation.md](docs/nlp-evaluation.md) — méthode, résultats mesurés et limites de l’évaluation NLP.
- [docs/sparql-examples.md](docs/sparql-examples.md) — exemples de requêtes SPARQL et vocabulaire de l’ontologie.
- [frontend/src/app/shared/ui/CONTRACT.md](frontend/src/app/shared/ui/CONTRACT.md) — conventions et contrat des composants UI.
