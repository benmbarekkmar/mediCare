# PROMPT D'AUDIT — MedicCare : vérifier les 10 phases, corriger, conclure

Tu es chargé de **l'audit final et complet** du projet `C:\Users\kmarb\medicare` (MedicCare : Angular 18 + Express + Apache Jena Fuseki + service NLP à règles). Les 10 phases de `PROMPT.md` ont été déclarées terminées. **Tu ne pars pas du principe que c'est vrai** : tu vérifies chaque exigence en l'exécutant, tu corriges tout ce qui est cassé ou manquant, et tu rends un rapport avec preuves.

---

## 0. Mandat

1. Lis **entièrement** `C:\Users\kmarb\medicare\PROMPT.md` (spéc + FINAL CHECKLIST). C'est la seule source de vérité des exigences ; ce document n'est qu'un état des lieux et un mode d'emploi.
2. Pour **chacune des 10 phases** : exécute les commandes, observe le comportement réel (HTTP + DOM), compare à l'exigence, note `OK / partiel / manquant / cassé`.
3. **Corrige** ce qui est cassé ou manquant, à la **racine** (jamais un contournement d'affichage ou de validation), puis **re-vérifie** et **re-lance les suites**.
4. Termine par le rapport §8.

## 1. Règles permanentes (non négociables)

- **Secrets** : ne jamais imprimer, logger, coller dans un fichier ou un rapport une clé/mot de passe réel. Vérifier par indirect (longueur, présence, code de retour). Ne jamais écrire de secret dans `.env` ni le committer. Le mot de passe des comptes de démo se lit depuis `SEED_DEMO_PASSWORD` (défaut documenté) — ne pas le recopier ailleurs.
- **Données** : ne jamais modifier/supprimer des données existantes ni court-circuiter une permission, une validation d'axiome ou un garde-fou RBAC « pour faire passer un test ». Les essais d'écriture se font **uniquement** sur le dataset isolé **`medicare_test`** ; le dataset de travail est `medicare`. Prouver qu'un backup est restaurable avant toute opération sensible.
- **Git / base** : aucune opération destructive (`reset --hard`, `clean -f`, `checkout --`, `push --force`, suppression de branche/volume) sans accord explicite. **Ne commite et ne pousse pas** sans le demander : le dépôt racine **et** le sous-module `frontend` (`git -C frontend`) ont du travail en cours non commité — signale-le, ne le détruis pas.
- **Dépendances** : pas de mise à niveau automatique. Pour `npm audit` : identifier les 2 avis critiques, dire quelle version les corrige, et n'appliquer **que** les correctifs sans changement de majeure ; sinon recommander et attendre.
- **Méthode** : une phase vérifiée = un compte rendu court ; corriger avant de passer à la suite ; ne pas déclarer « terminé » sans la preuve de la commande exécutée dans **cette** session.
- **UI (goûts validés par le client)** : textes d'interface en **français réel** (+ anglais équivalent) ; « moderne/animé » = mouvement sobre, pas de décoration ni de blocs non demandés ; **aucun scroll horizontal**, y compris à 375 px (largeurs fixes + troncature + cartes empilées sous `lg`) ; placeholders = consigne « quoi écrire », jamais une valeur d'exemple.
- **Vérification visuelle** : par **assertions DOM** (`evaluate_script` / Playwright), pas par capture d'écran. Note : le viewport par défaut masque les layouts `lg:` → mesurer à 375 px, 768 px et 1440 px.

## 2. Environnement

- Java 17 est installé (`C:\Program Files\Java\jdk-17`) ; Docker Desktop **peut** fonctionner (il a été capricieux : « Docker Desktop is unable to start »). Si `npm run infra` échoue, fallback **documenté par la spec** : Fuseki binaire local (`apache-jena-fuseki-5.x.zip`, ~50 Mo) lancé sur 3030 avec **les deux datasets** `medicare` **et** `medicare_test`, mêmes chemins `/medicare/query` `/medicare/update`, même utilisateur/mot de passe admin que `docker-compose.yml`. En mode `--mem`, relancer `npm run ontology` + `npm run seed` après chaque redémarrage ; en TDB2 (`--loc=`) c'est persistant.
- `python3` est un **stub Microsoft Store inutilisable** → piloter le NLP via `npm run nlp:test` / `nlp:evaluate` / `nlp:intents` (qui utilisent le venv de `backend/nlp-service`) et écrire tes scripts one-shot en **node**.
- Shell = Git-Bash : `/tmp` ↔ `C:\Users\kmarb\AppData\Local\Temp` ; passe `$(cygpath -w /tmp/x.log)` aux commandes node.
- Les logs Angular contiennent **ANSI + CRLF** : ne compte pas les erreurs avec `grep '^X \[ERROR]'`. Déduits et nettoie :
  `node -e "const fs=require('fs');const t=fs.readFileSync(process.argv[1],'utf8').replace(/\x1b\[[0-9;]*m/g,'');console.log((t.match(/\[ERROR\][\s\S]{0,200}/g)||[]).length, /Application bundle generation failed/.test(t))" "$(cygpath -w /tmp/ng.log)"`
  Les fichiers du dépôt sont en **CRLF** : dans un script de remplacement, ancre sur **une seule ligne** à la fois.
- `npx ng build` ≈ 150 s ; `npm test` (karma) ≈ 1-2 min. **Centralise les builds** : si tu délègues, les sous-agents n'ont pas le droit de lancer `ng build`/`npm`/`npx`/`git`.

## 3. Ce qui est déjà là (carte, à ne pas recréer)

**Racine** : `PROMPT.md`, `package.json` (`infra`, `infra:down`, `ontology`, `seed`, `nlp`, `api`, `web`, `build`, `test:api`, `test:nlp`, `test:web`, `lint`), `docker-compose.yml`, `README.md`, `docs/{tools-used,sparql-examples,nlp-evaluation,demo-script}.md`, `RELAY-PROMPT.md` (artefact de relai → à supprimer du dépôt en fin d'audit).

**Backend** (`backend/`, Express + TS strict + zod + pino + better-sqlite3 + jsonwebtoken + bcrypt) :
`src/app.ts` (montage `/api/*`, helmet, cors, rate-limit, `/api/docs` via `src/openapi.ts`), `src/config/env.ts` (toutes les variables), `src/core/{errors,http}.ts`, `src/http/{body,guards,query,public-projection}.ts`, `src/db/sqlite.ts`, `src/auth/{model,middleware,tokens,user.repo,audit}.ts`, `src/ontology/{registry,triples,writer,validator,hierarchy,derive}.ts`, `src/repos/{entity.repo,filters}.ts`, `src/services/{ontology,search,dashboard,consistency}.ts` + `query-guard.ts`, `src/sparql/{client,builders,escape,prefixes}.ts`, `src/nlp/{client,policy}.ts`, `src/routes/{auth,entities,public,search,dashboard,consistency,ontology,nlp,console,meta,users}.routes.ts`, `tests/unit/*` (9 fichiers), `tests/integration/{auth-rbac,crud-materialization,nlp-ask,query-aggregation}.spec.ts`, `tests/setup/{api,env,store}.ts`, `scripts/{seed,demo-accounts,load-ontology,reset,run-nlp}.ts`, `ontology/MedicCare_final_en.ttl` + `MedicCare_final_fuseki_en.ttl`, `nlp-service/{app,scripts,tests,data}` (FastAPI : classifier, entities, intents, lexicon, normalize, pipeline, sparql_builder, explain, evaluation, fuseki, main).

**Frontend** (`frontend/`, Angular 18.2 standalone + signals, `strictTemplates`, `isolatedModules`, `noPropertyAccessFromIndexSignature`) :
`src/app/app.routes.ts`, `app.config.ts`, `core/{api,auth,i18n,theme,toast,util}` (dont `util/list-state.ts` = état liste ↔ URL), `layout/` (shell, **portal-shell** = layout patient distinct, sidebar, topbar, command-palette, nav.config, breadcrumbs, notifications), `shared/ui/` (~36 composants + `CONTRACT.md` qui **définit les API des composants** : lis-le avant de les utiliser), `shared/ui/icon/icons.ts` (liste blanche d'icônes ; `ui-icon` accepte `size` number|string), `features/{public,auth,errors,profile,records,admin,calendar,staff,patient,tools}`, `styles/{_tokens,_base,_forms,_mixins,_utilities,_print}.scss`, `public/i18n/fragments/{en,fr}/*.json` (16 namespaces), `scripts/{merge-i18n.mjs,check-i18n.mjs}`, `playwright.config.ts` + `e2e/medicare.spec.ts`.
Librairies : `@angular/cdk`, `@ngx-translate/core` v16 (**pas d'ICU**), `@fullcalendar/{angular,core,daygrid,timegrid,interaction}` (**`list` non installé**), `@codemirror/*`, `cytoscape`, `chart.js`+`ng2-charts`, `lucide-angular`, tailwind, karma/jasmine, `@playwright/test` ^1.64.

**Trois contraintes d'architecture déjà payées, à respecter** :
- `/api/meta/entities` exige un jeton → **les pages publiques ne doivent pas dépendre des métadonnées** (elles déduisent libellés et faits des lignes).
- `/api/public/:entity` passe par `publicize()` : **aucune** relation vers un patient ne sort en anonyme. Vérifie-le par requête HTTP réelle, pas en lisant le code.
- `/api/nlp/*` exige un rôle → la page `/assistant` **anonyme** est une page explicative ; l'assistant authentifié est celui qui interroge le store.

## 4. Points déjà identifiés par l'audit préalable (à clore en priorité)

1. **Aucun commit** : 17 entrées modifiées/créées en racine (dont `README.md` et `docs/` non suivis) + 24 dans le sous-module `frontend`. → Tout est fragile. Ne commite pas sans accord, mais signale-le explicitement et propose l'ordre (sous-module d'abord, puis pointer le SHA en racine).
2. **Responsive 375 px jamais prouvé** : `playwright.config.ts` ne déclare que `devices['Desktop Chrome']` ; aucun `viewport`/`375`/`scrollWidth` dans `e2e/medicare.spec.ts` ; le fichier `e2e/ui-diagnostic.spec.ts` cité dans un compte rendu **n'existe plus**. → Ajouter un **project mobile 375 px** et une assertion `document.documentElement.scrollWidth <= innerWidth` sur les pages des Phases 5 à 9 (§6).
3. **`NG8011` = bug d'affichage réel** : un nœud `[uiCardFooter]` n'est **pas projeté** car l'`@if` englobant a plusieurs nœuds à sa racine. Localiser (message dans le build) et corriger la structure du template.
4. **2 dépassements de budget SCSS** : `features/tools/assistant.component.ts` (+2,00 kB) et `features/tools/explorer.component.ts` (+254 o). Réduire le style de composant ou justifier le budget — pas en baissant la limite sans raison.
5. **`npm audit` : 55 avis dont 2 critiques**, non qualifiés (§1 : pas d'upgrade automatique).
6. **Bruit `NG8102`/`NG8107`** (ops `?.`/`??` superflus) : sans impact, à réduire si cheap. Erreurs de canvas Chart.js en karma headless : les tests passent, mais vérifier que les **graphiques s'affichent vraiment** dans le navigateur (un canvas mort en test peut être vivant en prod — et l'inverse).

## 5. Protocole de vérification (ordre d'exécution)

```bash
# 1) socle
cd /c/Users/kmarb/medicare
npm run infra          # Fuseki ; sinon fallback Java §2
npm run ontology       # clear + load des .ttl
npm run seed           # lignes de démo dans medicare
# 2) suites
npm run test:api       # backend (attendu ~240 tests, AUCUN skipped : un skip = preuve manquante)
npm run test:nlp       # pytest nlp-service (~292)
npm run nlp:evaluate   # évaluation sur Fuseki (~137 cas / 48 intents)
# 3) front
cd frontend && npm run i18n && npm run check-i18n && npx ng build && npm test
npm run e2e            # Playwright, contre l'API + le front démarrés
# 4) exécution réelle
npm run api & npm run web &   # 4000 et 4300 ; vérifier /api/docs
```
Traque absolue : **un test « skipped » n'est pas un test passé.** Les 130 tests d'intégration ont déjà été masqués une fois par l'absence de Fuseki. Toute la Phase 5-10 doit être revue avec les suites réellement vertes.

## 6. Grille d'audit, phase par phase (exigences précises, avec le test qui prouve)

**Phase 0 — scaffolding** : `docker-compose.yml` monte Fuseki avec **deux** datasets persistés (volume qui survit à `docker compose down`) ; scripts racine réels ; TS strict et linter configurés. *Prouve* : `docker compose ps`, un write puis un `infra:down`/`up` et le recompte des triplets.

**Phase 1 — backend core + SPARQL** : ontologie chargée (`MedicCare_final_fuseki_en.ttl`), registry des **10 entités**, écriture = **une seule mise à jour SPARQL atomique** incluant la matérialisation des inférences (closure de sous-classes, propriétés inverses, property chains, classes définies) ; validation d'axiomes avec rejet `AXIOM_VIOLATION` ; échappement correct des littéraux/IRI ; pagination/tri/recherche/filtres server-side. *Prouve* : crée une ligne en `medicare_test`, liste les triplets générés, vérifie qu'un write invalide **roule back intégralement** (aucun triplet partiel), et compare avec `docs/sparql-examples.md`.

**Phase 2 — auth, rôles, RBAC, portées, audit** : 5 rôles (ADMIN, DOCTOR, RECEPTIONIST, PATIENT + public) ; access/refresh avec rotation et révocation ; verrouillage/rate-limit sur `/auth` ; **portée des données** : un médecin ne lit que ses patients, un patient que son dossier (y compris via SPARQL console et NLP) ; audit immuable et complet (LOGIN, LOGIN_FAILED, LOGOUT, CREATE/UPDATE/DELETE par entité, export). *Prouve* : la suite `auth-rbac` + une matrice « rôle × endpoint » exécutée en HTTP réel (403 attendus sur les endpoints hors périmètre, y compris en forçant un `?patient=` d'un autre).

**Phase 3 — NLP sans LLM** : NL→intent→slots→SPARQL en FR et EN ; normalisation (accents, pluriels, synonymes du lexique) ; garde-fous (`policy.ts`) : refus hors périmètre, **refus de requête qui touche un patient non autorisé même si le modèle la propose** ; confiance retournée ; explication/puces. *Prouve* : 10 questions FR + 10 EN réellement posées à `/api/nlp/ask`, SPARQL affiché et résultats cohérents avec un `SELECT` manuel ; 2 tentatives d'injection de périmètre doivent échouer.

**Phase 4 — fondations & design system** : `shared/ui/CONTRACT.md` tenu (mêmes composants partout, aucun style de page qui redéfinit un composant) ; tokens CSS ; thèmes clair/sombre persistés ; i18n 100 % (aucune clé brute affichée, EN/FR en parité, `check-i18n` vert) ; état de chargement (`ui-skeleton`), vide, erreur avec retry ; accessibilité clavier + focus visible + ARIA. *Prouve* : `npm run check-i18n`, bascule de thème/langue via DOM, tabulation complète sur une liste + un formulaire.

**Phase 5 — pages publiques & partagées** : accueil, 7 catalogues publics **sans jeton** (maladies, symptômes, traitements, médicaments, hôpitaux, services, annuaire médecins) + fiches détail liées entre elles ; **vérifie l'absence de fuite patient** en HTTP anonyme (liste ET détail) ; login / register (auto-creation patient côté réception ? respecte la spec) / forgot-password **sans oracle de compte existant** ; 403 / 404 / 500 réelles et navigables ; profil (le rôle relié au profil individuel) + réglages (langue, thème, mot de passe, sessions) ; **ADMIN voit l'état de Fuseki en lecture seule** (santé, dataset, triplets, classes, individus) et les statistiques d'ontologie. *Prouve* : `curl` anonyme sur chaque catalogue + une fiche ; DOM à 375 px ; une soude de formulaire avec erreurs → messages localisés affichés.

**Phase 6 — back-office ADMIN** : dashboard avec **les graphiques nommés dans PROMPT.md** (valeurs réelles, légendes, axes, CSV exportable) ; CRUD complet des **10 entités** (liste paginée/triable/filtrable, détail, formulaire avec champs obligatoires/typage/validation d'axiome, suppression **confirmée** et qui nettoie les liens) ; **calendrier** mois/semaine/jour, code-couleur, clic pour créer/éditer, **glisser-déposer pour replanifier** avec persistance réelle côté serveur ; gestion des utilisateurs (création, rôle, activation, réassignation de profil) ; journal d'audit filtrable + export ; page de cohérence. *Prouve* : crée/édite/supprime une entité de chaque type en `medicare_test`, replanifie un RDV par glissement puis recharge la page (la nouvelle date doit tenir), vérifie qu'un delete d'un hôpital utilisé est bloqué ou géré comme la spec le dit.

**Phase 7 — DOCTOR / RECEPTIONIST** : médecin → RDV du jour, mes patients, mes RDV, mes analyses (création/édition de `Test` avec date/résultat/valeur), base de connaissances **lecture seule**, assistant porté sur ses patients uniquement, explorateur lecture seule. Réception → dashboard, CRUD RDV avec **avertissement de conflit** (même médecin/même créneau, `findClashes`), CRUD patient **identité seulement** (aucun champ clinique modifiable), annuaire lecture seule. *Prouve* : session médecin sur le dossier d'un patient qu'il **ne suit pas** → 403/absence de ligne ; session réception essayant d'écrire un diagnostic → refus ; conflit de créneau réellement signalé **et** bloquant ou surchargeable selon la spec.

**Phase 8 — portail PATIENT** : layout **distinct** visuellement (pas le shell admin), dashboard, **dossier imprimable** (`_print.scss` : en `@media print`, pas de nav latérale ni boutons, dates lisibles — teste via `page.emulateMedia({media:'print'})`), RDV + **stepper de demande** service → médecin → date/créneau → confirmation (création réelle côté serveur, statut d'attente), trouver un médecin, hôpitaux/services, bibliothèque de santé, assistant **limité**, profil. *Prouve* : le patient A ne voit **jamais** les données du patient B, ni en liste, ni en URL directe (`/patient/.../<id>` d'un autre), ni via l'assistant, ni via `/api/public`.

**Phase 9 — outils intelligents** : assistant (puces langue/intent/confiance/entités, bloc SPARQL copiable, « ouvrir dans la console », export CSV, historique persistant, puces d'exemples, dictée vocale **optionnelle** et dégradée proprement si le navigateur ne l'a pas) ; console SPARQL (CodeMirror, modèles, `Ctrl+Entrée`, historique, requêtes enregistrées, **lecture seule pour les non-ADMIN**, export CSV) ; explorateur d'ontologie (Cytoscape : arbre des classes, focus/expand, layouts, légende, panneau de détail avec les 4 onglets, liens vers les fiches). *Prouve* : une question → SPARQL → résultats → CSV ; une écriture refusée par la console en rôle non-ADMIN ; `Ctrl+Entrée` déclenche bien l'exécution ; l'explorateur reste utilisable à 375 px (pas de scroll horizontal).

**Phase 10 — tests, e2e, docs, FINAL CHECKLIST** :
- Playwright : les 4 scénarios exigés (login par rôle, création patient, création RDV, question NLP → SPARQL → résultats) **plus** le mobile 375 px (§4.2). Vérifie que les specs tournent sur `medicare_test`, pas sur `medicare`.
- Docs : `README.md` (mermaid, prérequis, env, chargement d'ontologie, commandes, **comptes de démo réellement utilisables**, **matrice de permissions** « Role permissions » conforme au code, API overview, `Troubleshooting`, notes de validation) ; `docs/tools-used.md` avec section NLP/TALN et la mention explicite **« NO LLM API »** ; `docs/sparql-examples.md` ≥ 25 exemples **exécutables tels quels** (préfixes corrects) — teste-en au moins 8 contre le store ; `docs/nlp-evaluation.md` cohérent avec `npm run nlp:evaluate` (re-génère les chiffres, ne pas les recopier) ; `docs/demo-script.md` qui marche étape par étape.
- `/api/docs` servi et couvrant routes publiques, CRUD, auth, NLP, console.
- **FINAL CHECKLIST de `PROMPT.md`** : recopie-la intégralement dans ton rapport, item par item, avec la preuve (commande + sortie) ou le correctif appliqué.

## 7. Chasse aux bugs (à tester explicitement, même si « tout est vert »)

- Fuite de données : `/api/public/:entity` (liste **et** détail), export CSV, logs serveur (un nom/IRI de patient ne doit pas se retrouver loggé), suggestions d'auto-complétion, `Ref` dans les relations.
- RBAC latéral : changer un `id`/`patient` dans l'URL ou le corps ; forger un jeton d'un autre rôle ; réutiliser un refresh token révoqué ; accès croisé médecin↔patient.
- Cohérence ontologique : suppression d'une entité référencée (doctor sans département, medication sans treatment), création hors axiome, doublons d'IRI, chargement d'ontologie deux fois de suite (idempotence).
- États frontaux : API éteinte → état d'erreur + retry ; réponse vide → état vide ; requête longue → skeleton ; double soumission de formulaire ; validation côté serveur contournable (champ désactivé côté front ne suffit pas).
- i18n : bascule en cours de route (aucune chaîne mixte FR/EN), dates selon la langue, `plural` sans ICU, aucune clé brute affichée, `check-i18n` vert.
- Thème : contrastes des chips/badges/dark, icônes non listées dans `icons.ts` (rendent un glyph absent), pas de valeur de couleur codée en dur qui casse en sombre.
- Performance/quantité : listes de 500+ lignes, `LIMIT` appliqué, pagination serveur (pas client), tri côté serveur, requêtes N+1 sur les fiches détail.
- Console/assistant : SPARQL mal formé → message clair sans stack ; injection dans un IRI/littéral ; historique trop long.
- Faux positifs : Chart.js en canvas headless, tests qui passent parce qu'ils n'attendent rien (`expect` absent), `waitForTimeout` qui masque une vraie attente, specs e2e qui écrivent dans `medicare`.

## 8. Rapport final attendu (forme)

1. **Tableau des 10 phases** : `phase | statut (OK / partiel / manquant) | preuve (commande + sortie brute) | correctifs appliqués (fichier:ligne) | restant`.
2. **Liste des bugs trouvés** : gravité (bloquant / majeur / mineur), reproduction, correction, re-vérification.
3. **Chiffres de validation** : backend (avec **zéro skipped**), NLP (tests + évaluation, chiffres **re-mesurés**), front (karma, build dev+prod, `check-i18n`, Playwright y compris mobile), `/api/docs` OK.
4. **Avertissements restants assumés** : lesquels, pourquoi non bloquants, et ce qu'il faudrait pour les fermer.
5. **Dépendances** : les 2 avis critiques qualifiés (CVE, version de correction, action prise ou recommandation).
6. **FINAL CHECKLIST** de `PROMPT.md` recopiée et cochée avec preuve.
7. **Étiquette de fin** : `git status` complet des **deux** dépôts (racine + sous-module), liste des fichiers à ne pas committer (`.env`, `node_modules`, `data/*.db`, dumps, artefacts temporaires type `RELAY-PROMPT.md`), et **proposition de commit sans l'exécuter** sauf accord.

Ne conclus jamais « projet terminé » sans : suites réellement vertes **et non skipées**, pages vues en navigateur avec assertions DOM, preuves écrites dans le rapport.
