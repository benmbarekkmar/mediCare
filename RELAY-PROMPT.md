# PROMPT DE RELÈVE — MedicCare (phases 4 à 10)

> À coller tel quel dans une nouvelle session. Il décrit **tout ce qui a été fait** (Phases 0 à 3 terminées et vérifiées, Phase 4 presque terminée) et **tout ce qui reste**, avec les commandes exactes, les pièges déjà découverts et l'inventaire des erreurs en cours.

**Première action attendue de l'agent** : lire ce fichier, puis exécuter §5.2 (mesurer le build), finir la Phase 4 (§5.3 + §5.4), rendre compte, puis enchaîner Phases 5 → 10 dans l'ordre (§6, §7) en respectant les règles §0. Ne pas ré-écrire ce qui existe déjà : corriger la compilation et compléter les trous.

**Instruction d'origine (toujours en vigueur)** : « Lis PROMPT.md en entier, exécute-le phase par phase en commençant par la Phase 0 et enchaîne toutes les phases sans me demander de confirmation entre les phases. Les fichiers d'ontologie sont déjà dans `backend/ontology/`. Après chaque phase tu dois installer, builder, lancer et tester, et corriger chaque erreur avant de passer à la suite. Pas de données mock, pas de placeholders, pas d'exigence sautée. À la fin, vérifier le FINAL CHECKLIST de PROMPT.md. »

---

## 0. Mission et règles permanentes (ne jamais les relâcher)

1. Lis **`C:\Users\kmarb\medicare\PROMPT.md`** en entier : c'est la spécification complète (10 phases + FINAL CHECKLIST).
2. Exécute les phases **dans l'ordre**, sans demander d'accord entre les phases, mais **une phase à la fois** : à la fin d'une phase → installer, build, run, tester, corriger **toutes** les erreurs, puis s'arrêter et rendre compte.
3. **Aucune donnée factice « mock », aucun placeholder, aucun exigence sautée.** Le seed crée de vraies lignes dans l'ontologie ; les pages affichent de vraies données.
4. Sécurité / données (règles absolues, déjà appliquées) :
   - Ne **jamais** imprimer, logger, copier un secret ; vérifier par indirect ; rediger les diffs ; ne jamais écrire de clé dans `.env` ni la committer.
   - Ne **jamais** toucher les données/mots de passe existants ni court-circuiter permissions/validation pour faciliter une démo. Le seed ne touche **que** ses propres lignes.
   - Aucune opération git/DB destructive sans accord explicite. Les essais se font sur le dataset isolé **`medicare_test`**, et on prouve que les backups sont restaurables.
   - Corriger la **cause racine**, jamais un contournement dans la vue ou le modèle.
5. UI (goûts validés par l'utilisateur) :
   - Demandes en français familier ; **textes d'interface en français réel** (et anglais équivalent).
   - « moderne/animé » = mouvement sobre ; l'utilisateur supprime la décoration et les blocs non demandés → ne pas en ajouter.
   - **Pas de scroll horizontal** : largeurs fixes + troncature + cartes empilées sous `lg` (vérifier à 375 px).
   - Placeholders = consigne « quoi écrire », jamais une valeur d'exemple.
   - Vérification UI par **assertions DOM via `evaluate_script`** (les captures d'écran ne sont pas fiables ; le viewport masque les layouts `lg:`).
6. Nettoyage : les scripts temporaires créés pendant le travail doivent être supprimés **par leur nom**, une fois prouvés redondants ; garder tout ce qui est ambigu.

---

## 1. État global (véridique, daté du 2026-10-29)

| Phase | Contenu | État |
|---|---|---|
| 0 | Scaffolding racine/backend/frontend, docker-compose, configs | **terminée** |
| 1 | Backend core + couche SPARQL (Fuseki) | **terminée**, `npx tsc --noEmit` propre, **106 tests unitaires** + 4 nouveaux |
| 2 | Auth, rôles, RBAC, portées de données, audit | **terminée**, intégration `auth-rbac.spec.ts` |
| 3 | Module NLP (anglais/français → SPARQL, sans LLM) | **terminée**, service FastAPI + tests pytest + `nlp-policy.spec.ts` |
| 4 | Fondations frontend + design system | **~90 %** : il reste à faire passer `ng build` à zéro erreur |
| 5 | Pages publiques + partagées (login/register/forgot, 403/404/500, profil & réglages) | fichiers **écrits**, non compilés/validés |
| 6 | Back-office admin (dashboard + 10 entités + calendrier + users + audit) | fichiers **écrits**, non validés |
| 7 | Vues médecin / réception | fichiers **écrits**, non validés |
| 8 | Portail patient (layout distinct, impression, stepper de demande) | fichiers **écrits**, non validés |
| 9 | Outils intelligents (assistant, console SPARQL, explorateur) | fichiers **écrits**, **erreurs connues** (voir §5) |
| 10 | Tests e2e + documentation + FINAL CHECKLIST | **non démarrée** (`docs/` est vide) |

Backend vérifié cette session : `cd backend && npx tsc --noEmit` (aucune sortie) et `npx vitest run tests/unit` → **106 passed**.

---

## 2. Ce qui existe déjà — carte exacte du projet

### 2.1 Racine
```
PROMPT.md                 package.json (scripts agrégats)      docker-compose.yml (Fuseki)
docs/                     (vide → à écrire en Phase 10)
backend/  frontend/       (frontend est un sous-module git : utiliser git -C frontend)
```
Scripts racine : `npm run infra | infra:down | ontology | seed | nlp | api | web | build | test:api | test:nlp | test:web | lint`.

### 2.2 Backend (`backend/`, Express + TS strict, ESM via tsx)
```
src/app.ts                    montage des routers sous /api + helmet/cors/rate-limit + /api/docs (swagger-ui)
src/server.ts
src/config/env.ts             zod, toutes les variables (voir §2.5)
src/config/logger.ts          pino
src/core/{errors,http}.ts     ApiError, problem-json, notFoundHandler, errorHandler, asyncHandler
src/http/{body,guards,query}.ts
src/http/public-projection.ts publicize(def,item) : retire les relations vers patients des réponses publiques
src/db/sqlite.ts              better-sqlite3 (users, sessions, audit, permissions)
src/auth/{model,middleware,tokens,user.repo,audit}.ts
src/ontology/{registry,triples,writer,validator,hierarchy,derive}.ts
src/repos/{entity.repo,filters}.ts
src/services/{ontology,search,dashboard,consistency}.ts  + query-guard.ts (portée RBAC des requêtes SPARQL)
src/sparql/{client,builders,escape,prefixes}.ts
src/nlp/{client,policy}.ts    appel du service Python + politique (refus hors périmètre, garde-fous)
src/routes/{auth,entities,public,search,dashboard,consistency,ontology,nlp,console,meta,users}.routes.ts
src/openapi.ts
tests/unit/*.spec.ts (9 fichiers), tests/integration/*.spec.ts (4 fichiers), tests/setup/{api,env,store}.ts
scripts/{seed,demo-accounts,load-ontology,reset,run-nlp}.ts   (+ tmp-contract.ts → scratch à supprimer)
ontology/MedicCare_final_en.ttl, MedicCare_final_fuseki_en.ttl
nlp-service/{app,scripts,tests,data}  FastAPI : classifier, entities, intents, lexicon, normalize,
                              pipeline, sparql_builder, explain, evaluation, fuseki, main + .venv
```
Points d'API (montés dans `src/app.ts`) : `/api/public`, `/api/auth`, `/api/users`, `/api/audit`, `/api/permissions`, `/api/<entities>`, `/api/search`, `/api/dashboard`, `/api/consistency`, `/api/ontology`, `/api/nlp`, `/api/console`, `/api/sparql`, `/api/meta`, docs à `/api/docs`.

**Contraintes backend déjà descobertées (à respecter)** :
- `/api/public/:entity` utilise `optionalAuth` et n'expose que `diseases, symptoms, treatments, medications, hospitals, departments, doctors` ; les lignes sont passées dans `publicize()` (pas de lien vers un patient).
- `/api/meta/entities` est gardé par `authenticate` → **les pages publiques ne doivent pas dépendre des métadonnées**.
- `/api/nlp/*` exige un rôle (ADMIN/DOCTOR/RECEPTIONIST/PATIENT) → l'assistant **anonyme** est une page explicative, elle ne peut pas appeler `/nlp/ask`.
- Les tests d'intégration tournent sur le dataset **`medicare_test`** (voir `tests/setup/env.ts`), jamais sur `medicare`.

Variables d'env (`backend/src/config/env.ts`, `.env.example` existe) : `NODE_ENV, PORT, CORS_ORIGINS, FUSEKI_BASE_URL, FUSEKI_DATASET, FUSEKI_QUERY_PATH, FUSEKI_UPDATE_PATH, FUSEKI_USER, FUSEKI_PASSWORD, FUSEKI_QUERY_TIMEOUT_MS, FUSEKI_SPARQL_LIMIT_CAP, JWT_SECRET, JWT_ACCESS_TTL_MINUTES, JWT_REFRESH_TTL_DAYS, BCRYPT_ROUNDS, SQLITE_FILE, NLP_SERVICE_URL, NLP_TIMEOUT_MS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, LOG_LEVEL, LOG_PRETTY, SEED_DEMO_PASSWORD`. → Documenter tout ça dans le README, **sans jamais recopier une valeur secrète réelle** (prendre les valeurs par défaut non sensibles, et dire où les définir).

### 2.3 Frontend (`frontend/`, Angular 18.2 standalone + signals, strictTemplates)
```
src/app/app.routes.ts     toutes les routes (publiques, shell admin/médecin/réception, portail patient)
src/app/app.config.ts     providers : translate loader, interceptors (auth + api problem), guards
src/app/core/api/         models.ts (EntityMeta, DataFieldMeta, RelationMeta, Individual, Ref, Page, EntityInput…)
                          api.service, entity.service (EntitiesService, MetaService), account.service,
                          nlp.service, ontology.service, insight.service, error.interceptor
src/app/core/auth/        auth.service (isLoggedIn/hasRole/…), auth.interceptor, guards (permissionGuard)
src/app/core/{i18n,theme,toast}/   SUPPORTED_LANGS, theme (clair/sombre), ToastService
src/app/core/util/        format.ts (compact/formatDate/formatDateTime/relativeTime), labels.ts, csv.ts,
                          list-state.ts (UrlListState : source unique état liste ↔ URL)
src/app/layout/           shell, portal-shell (layout PATIENT distinct), sidebar, topbar,
                          command-palette, nav.config, breadcrumbs.service, notifications.service
src/app/shared/ui/        CONTRACT.md (le contrat du design system) + ~35 composants :
                          alert avatar badge breadcrumb button card chart checkbox chip code-block
                          combobox confirm-dialog date drawer dropdown empty-state error-state filter-bar
                          icon input modal page-header pagination radio search-box select skeleton
                          stat-card stepper switch table tabs textarea timeline toast tooltip tree
                          + focus-trap.directive.ts, translate-testing.ts (helper pour les specs)
src/app/features/
  public/     home (.html/.scss), browse, detail, ask
  auth/       login, register, forgot-password
  errors/     forbidden, not-found, server-error
  profile/    profile, settings
  records/    record-list, record-detail, entity-form  (métadonnées → sert les 10 entités)
  admin/      dashboard, users, audit, consistency
  calendar/   calendar-page + calendar.utils (créneaux, détection de conflits)
  staff/      day (vue médecin/réception : rendez-vous du jour)
  patient/    dashboard, my-record (impression), appointments, request (stepper)
  tools/      assistant, console, explorer
src/styles/               _tokens.scss (variables CSS), _base, _forms, _mixins, _utilities, _print.scss
public/i18n/fragments/{en,fr}/  admin auth calendar chat common form nav pages palette profile records
                          settings staff ui-forms ui uipage  →  fusionnés en public/i18n/{en,fr}.json
scripts/merge-i18n.mjs    `npm run i18n` : fusionne les fragments, ÉCHEC (exit 1) si une clé existe dans
                          une langue et pas l'autre
scripts/check-i18n.mjs    `npm run check-i18n` : liste les clés utilisées dans le code mais absentes des catalogues
```
Bibliothèques réellement installées : `@angular/cdk`, `@ngx-translate/core` v16, `@fullcalendar/{angular,core,daygrid,timegrid,interaction}` (**pas `@fullcalendar/list`**), `@codemirror/*`, `cytoscape`, `chart.js` + `ng2-charts`, `lucide-angular`, `tailwindcss`, karma/jasmine (**Playwright non installé** → Phase 10).

### 2.4Décisions d'architecture prises (ne pas les contester, elles sont déjà payées)
- **Un seul** `PublicBrowseComponent` / `PublicDetailComponent` dessert les 7 catalogues publics via la `data` de la route (`entity`, `icon`, `titleKey`, `ledeKey`, `crumbKey`) : pas de copie par catalogue.
- Le trio **métadonnées** (`entity-form`, `record-list`, `record-detail`) sert les **10 entités** : CRUD + détail + suppression, colonnes et champs venant de `/meta/entities`.
- `/patient/assistant` et `/tools/assistant` partagent le même `AssistantComponent` (le portail patient passe un mode « portal » limité).
- `UrlListState` est **une classe plain** (construite avec `new`) : tri, page, recherche et filtres vivent dans la query string → lien partageable, bouton retour fonctionnel.
- L'audit i18n est machine-vérifié (`check-i18n`) plutôt qu'œil-à-œil.

### 2.5 Icônes : liste blanche (toute icône hors de cette liste casse au runtime)
`src/app/shared/ui/icon/icons.ts` expose ~97 clés, dont :
`activity alarm-clock arrow-down arrow-left arrow-right arrow-up arrow-up-down arrow-up-right bell book bot braces
building calendar calendar-check calendar-days chart chart-column check chevron-down chevron-left chevron-right
chevron-up circle-alert circle-check circle-help circle-x clipboard-list columns-3 copy database download ellipsis
external-link eye eye-off file-text filter fingerprint flask gauge git-branch globe graduation heart hospital
inbox info keyboard languages link list list-checks loader log-in log-out mail map-pin menu mic moon network
pencil phone pill plus printer refresh route save search send settings shield sliders sparkles spline star
stethoscope sun syringe table tag target terminal trash trash-2 upload user users wand waypoints x zap dashboard`
`ui-icon` accepte `size` en `number | string` ; `name` doit être une clé ci-dessus.

---

## 3. Compilation Angular — pièges DÉJÀ rencontrés, à réutiliser tels quels

Ces règles ont été apprises en corrigeant ~230 erreurs. Les appliquer du premier coup fait gagner un build entier.

1. `DOCUMENT` s'importe de **`@angular/common`** (pas `@angular/platform-browser`).
2. `Location` → `@angular/common`. `ActivatedRoute`, `Router`, `RouterLink` → `@angular/router`. `FormBuilder`, `FormGroup`, `Validators`, `ReactiveFormsModule` → **`@angular/forms`**. Ces trois erreurs sont typiques des fichiers écrits sans compiler.
3. `@for` : les variables de contexte doivent être **aliasées avec le `$`** → `@for (x of xs(); track x.id; let isFirst = $first; let isLast = $last)`. Écrire `first`/`last` nu ne compile pas.
4. `@if (expr(); as alias)` n'est autorisé que sur le **bloc `@if` primaire**. Sur un `@else if` → NG5002. Restructurer avec `@let nom = expr;` (Angular 18 le supporte) ou un `@if` imbriqué.
5. Un template ne peut pas appeler une fonction de portée module : l'exposer en membre de classe (ex. `compact()` dans `ui-tree`).
6. Une classe `get`Accessor s'utilise **sans parenthèses** (`this.visibleColumns`, pas `this.visibleColumns()`).
7. `isolatedModules` : import de type → `import type` ; **mais** un jeton d'injection (`Injector`, `TemplateRef`) doit rester un **import de valeur** sinon TS-992003/TS1361.
8. `elementRef.nativeElement` est `unknown`/`any` sans générique → `querySelector<HTMLElement>` échoue (TS2347). Écrire `(this.el.nativeElement as HTMLElement).querySelector<HTMLElement>(...)`.
9. `NodeList` : préférer `Array.from(nodes)` au spread (TS2488).
10. `TranslatePipe` de ngx-translate v16 est strict sur `null` : dans les blocs gardés `@if (hint() !== null)`, écrire `{{ (hint() ?? '') | translate }}`. **Pas de support ICU** (`{count, plural, …}` s'affiche en clair) → utiliser des paramètres `{count}` simples.
11. `rxjs` v7 : `throwError`, `catchError`, etc. depuis **`rxjs`** (pas `rxjs/operators`) — `rxjs/operators` compile encore mais ne pas propager.
12. Index signatures : `noPropertyAccessFromIndexSignature` est actif → `row.fields['date']`, `dataset['theme']`, jamais `row.fields.date`.
13. Les chemins relatifs des pages sont souvent écrits un niveau trop profond : du `src/app/features/<dir>/` vers le design system c'est `../../shared/ui/...` et `../../core/...` (pas `../../../`).
14. `ui-table.component.ts` ré-exporte `UiCellDirective`, `UiRowActionsDirective`, `UiIconButtonComponent` ; les états vides/erreur sont `shared/ui/empty-state/ui-empty-state.component.ts` et `shared/ui/error-state/ui-error-state.component.ts`. Le fichier `shared/ui/table/ui-states.component.ts` **a été supprimé** (10 imports migrés) — ne pas le recréer.
15. Le type de `columns`/`rows` de `ui-table` est générique : pour un typed row (`AuditEntry[]`, `PublicUser[]`, `UpcomingAppointment[]`, `Individual[]`), typer `TableColumn<X>[]` **et** le composant générique, sinon NG2 « not assignable to Record<string, unknown>[] ». Voir le motif utilisé dans `features/public/browse.component.ts` et `features/records/record-list.component.ts`.
16. `UrlListState.params` est un **signal**, pas un Observable : utiliser `effect`/`toSignal`, pas `.subscribe`.

---

## 4. Environnement de travail — gotchas machine (Windows / Git-Bash)

- **`python3` est un stub Microsoft Store inutilisable** → utiliser `node` pour toute scripting one-shot, et le venv du service NLP via `backend/scripts/run-nlp.ts` (`npm run nlp`, `npm run nlp:test`, `npm run nlp:evaluate`, `npm run nlp:intents`).
- `/tmp` de Git-Bash = `C:\Users\kmarb\AppData\Local\Temp` : pour passer un chemin de log à `node`, écrire `$(cygpath -w /tmp/ngb.log)`.
- Le log de build contient des **ANSI + CRLF** : ne pas compter les erreurs avec `grep '^X \[ERROR]'`. Utiliser le script existant `frontend/scripts/tmp-errlist.cjs <chemin-log>` (il déduplique et sort `fichier:ligne  code  message`).
- Les fichiers du dépôt sont en **CRLF** : dans un script Node de remplacement, **éviter les ancres multi-lignes** (`\n` dans la chaîne d'ancrage → « anchor missing »). Une ligne à la fois.
- Ne pas mettre de guillemets imbriqués dans `node -e "…"` : écrire un `.cjs` temporaire à la place.
- `npx ng build --configuration development` ≈ 150 s ; lancer avec un timeout large (600000 ms) et rediriger vers un log.
- **Centraliser les builds** : si des sous-agents travaillent, leur interdire `ng build` / `npm` / `npx` / `git` (deux sessions parallèles sur le même build ont déjà perdu du temps). Un seul endroit compile.
- Deux agents ont échoué en fin de course sur « credit usage limit / queuing failed » : leurs **fichiers sont bien écrits**, mais la partie `features/tools/*` n'a **pas** été corrigée (aucun `console.problem.ts` créé, aucun edit de `assistant/console/explorer` par eux).

---

## 5. Phase 4 — ce qui reste, précisément

### 5.1 Corrections déjà appliquées (ne pas les refaire)
- `UiEmptyStateComponent` / `UiErrorStateComponent` créés à leurs chemins contractuels ; `table/ui-states.component.ts` supprimé ; 11 sites d'import réécrits.
- `ui-table.component.ts` ré-exporte `UiCellDirective`, `UiRowActionsDirective`, `UiIconButtonComponent`.
- `ui-icon` : `size` accepte `number | string` (+ `pixels()` défensif) ; 7 clés ajoutées à `icons.ts` (`arrow-up-right`, `columns-3`, `fingerprint`, `inbox`, `link`, `target`, `trash-2`).
- `core/util/list-state.ts` : `@Injectable()` retiré, faute de syntaxe `map(([key, value)]` corrigée.
- `dropdown/modal/drawer` : `DOCUMENT` depuis `@angular/common`, `Injector` en import de valeur, `footerTemplate() ?? null`, `Array.from(querySelectorAll…)`.
- `combobox` : chemin `../../../core/api/models` corrigé.
- `alert` (`isDismissed`), `breadcrumb` (`$first/$last`), `page-header` (`backHref` narrow), `skeleton` (`lines`→`lineBlocks`), `table` (`visibleColumns` getter, `value(row, column.field)`), `tabs` (`TAB_KEYS.get`, cast), `tree` (`hit.id`, méthode `count()`, cast), `timeline` (`NgClass`+`RouterLink` importés), `focus-trap/input/textarea/combobox` (casts), form-fields `(x() ?? '') | translate`.
- `features/errors/{forbidden,not-found,server-error}.component.ts` : depths `../../` + `Location` depuis `@angular/common`.
- `features/patient/request.component.ts` : import `UiEmptyStateComponent` vers le nouveau chemin.
- Erreurs uniques : **229 → 135** avant la dernière passe ; la dernière passe (7 fichiers) n'a pas encore été re-mesurée.

### 5.2 Première commande à lancer (mesurer l'existant)
```bash
cd /c/Users/kmarb/medicare/frontend
npm run i18n
npx ng build --configuration development > /tmp/ngb3.log 2>&1; echo "exit=$?"
node scripts/tmp-errlist.cjs "$(cygpath -w /tmp/ngb3.log)"
```

### 5.3 Inventaire connu des erreurs restantes (dernier build complet)
**`features/tools/assistant.component.ts` (33)** — 408 et 582 NG5002 `as` sur un `@else if` ; 417→567 (26 sites) NG9 `Property 'answer' does not exist` : le template adresse `answer.*` alors que `answer` n'est pas un membre de la classe — lire la classe et binder le signal/computed réel ; 585 NG9 `Property 'message'` ; 1283/1284 TS7006 `item` implicite `any`.
**`features/tools/console.component.ts` (28)** — 28 TS2724 `@codemirror/language` n'exporte pas `BracketMatcher` (Vérifier les exports réels de `@codemirror/autocomplete`/`language`) ; 47 TS2307 module `./console.problem` inexistant (à créer selon l'usage, ou import à corriger) ; 502-519 TS2304 : 18 symboles listés dans `imports: []` mais **non importés** (`UiAlertComponent`, `UiBadgeComponent`, `UiButtonComponent`, `UiCardComponent`, `UiCardActionsDirective`, `UiCodeBlockComponent`, `UiConfirmDialogComponent`, `UiDropdownComponent`, `UiDropdownTriggerDirective`, `UiEmptyStateComponent`, `UiErrorStateComponent`, `UiIconComponent`, `UiIconButtonComponent`, `UiPageActionsDirective`, `UiPageHeaderComponent`, `UiPageMetaDirective`, `UiSkeletonComponent`, `UiTableComponent`) ; 1165 TS2353 `defaultCreate` inexistant dans `CompletionConfig` ; 1275 TS2339 `{ id: string }` trop étroit (`disabled`, `separator`) ; 1350/1388 `apiProblemMessage` introuvable (il existe un helper projet pour convertir une réponse d'API en message traduit, le grep dans `src/app/core`) ; 1469 TS1005 + TS2663 `langHack` + TS2554 : expression cassée, écrire ce qu'elle vise clairement.
**`features/tools/explorer.component.ts` (5)** — à relire depuis le log ; thème Cytoscape/arbre/détails.
**`features/records/record-detail.component.html` (11)** — 17 NG5002 ; 23/25/41/83/87/96/103 NG9 `Property 'individual'` (member réel à trouver dans le `.ts`) ; 32/35 NG4 get-accessor appelé ; 79 NG2 `pad="sm"` hors du type `UiCardPad` (voir `ui-card.component.ts`).
**`features/admin/users.component.ts` (7)** — 5/6/7 `FormBuilder/FormGroup/Validators` depuis `@angular/core` ; 94/106 NG5002 two-way binding invalide ; 120 NG2 `PublicUser[]` ; 401 TS2571.
**`features/admin/consistency.component.ts` (6)** — 103 NG5002 ; 105/107/109/112/117 NG9 `Property 'r'` (variable d'itération perdue).
**`features/records/entity-form.component.html` (4)** — 7 NG1 null ; 56 NG1 + NG4 get-accessor.
**`features/public/detail.component.ts` (5)** — 36 NG5002 ; 40/42/50/59 NG9 `Property 'item'`.
**`features/staff/day.component.ts` (4)** — 384/414 NG5002 ; 394/421 NG5 `WritableSignal<Ref|null>` passé là où un `string` est attendu.
**`features/records/record-list.component.html` (3) + `.ts` (1)** — générique `TableColumn<Individual>` vs `Row` ; 74 TS2339 `.subscribe` sur un signal.
**`features/admin/audit.component.ts` (3)** — 5/6 `ActivatedRoute/Router` depuis `@angular/core` ; 126 NG2 `AuditEntry[]`.
**`features/layout`** — `topbar.component.ts:26` stylesheet `./topbar.component.scss` **introuvable** (le fichier n'existe pas : soit le créer, soit retirer la référence) ; `topbar.component.html:86` `String` utilisé dans le template ; `portal-shell.component.html:10` `routerLinkActiveOptions` (il manque `RouterLinkActive` dans `imports`) et `:58` NG2 string/boolean ; `breadcrumbs.service.ts:46` `ActivatedRouteSnapshot | undefined`.
**`features/auth`** — `login.component.ts:351` TS2347 cast `querySelector<HTMLInputElement>` ; `register.component.ts:430` TS2345 `RegisterInput` sans index signature vers `Record<string, unknown>`.
**`features/patient/request.component.ts:850`** TS2339 `label` sur `{ field: string; values: string[] }`.
**`features/public/ask.component.ts:175/176`** TS7006 `item`.
**`features/admin/dashboard.component.ts:203`** NG2 `UpcomingAppointment[]`.

### 5.4 Fin de Phase 4 — checklist
- [ ] `npm run i18n && npx ng build` → **0 erreur** (les warnings NG8102/NG8107 sont acceptables mais à réduire).
- [ ] `npm run check-i18n` → aucune clé manquante ; EN et FR complets.
- [ ] Importer le **CSS de base de FullCalendar** (aucun endroit ne l'importe aujourd'hui) : `@fullcalendar/core/main.css`, `daygrid`, `timegrid` — soit dans `angular.json` `styles`, soit dans `src/styles.scss`.
- [ ] Le package `@fullcalendar/list` **n'est pas installé** : la Phase 6 exige day/week/month ; soit n'utiliser que ces trois vues, soit installer `@fullcalendar/list` (préférer : rester sur les vues installées, `listWeek` non requis).
- [ ] `npm test` (karma, ChromeHeadless) → les specs du design system passent (`*.spec.ts` existants : button, code-block, combobox, confirm-dialog, date-input, filter-bar, input, modal, pagination, select, toast-host, tooltip, tree, admin/dashboard, admin/users).
- [ ] Démarrer l'appli et vérifier dans le navigateur (règle §0.5) : public home, un catalogue, une fiche, login, shell admin, portail patient ; **pas de scroll horizontal à 375 px** ; bascule claire/sombre ; bascule EN/FR sans clé brute affichée.

---

## 6. Phases 5 → 9 — le travail restant après la compilation

Les fichiers existent ; il faut les **compiler, les raccorder et les vérifier**.

**Phase 5 — pages partagées** : login / register / forgot-password (avec message « e-mail envoyé » côté serveur, pas de fuite de compte existant), 403 / 404 / 500, profil & réglages (langue, thème, mot de passe, sessions actives). Exigence : **ADMIN voit aussi** un état Fuseki **en lecture seule** (santé, dataset, nombre de triplets, classes, individus) + des statistiques d'ontologie.

**Phase 6 — back-office ADMIN** : dashboard avec les graphiques nommés dans PROMPT.md (Chart.js via `ui-chart`), CRUD complet des **10 entités** (liste + détail + formulaire + suppression confirmée) via `records/*`, **calendrier** des rendez-vous (mois/semaine/jour, code-couleur par type, clic pour créer/éditer, glisser pour replanifier via `@fullcalendar/interaction`), gestion des utilisateurs (rôles, réactivation/réassignation), journal d'audit (filtres action/utilisateur/période, export CSV), page de cohérence ontologique (`/api/consistency`).

**Phase 7 — DOCTOR / RECEPTIONIST** : médecin → rendez-vous du jour, mes patients, mes rendez-vous, mes analyses, base de connaissances **lecture seule**, assistant **porté sur ses patients**, explorateur **lecture seule**. réception → dashboard, CRUD rendez-vous avec **avertissement de conflit** (utiliser `findClashes` de `features/calendar/calendar.utils.ts`), CRUD patient **identité seulement** (pas de données cliniques), annuaire hôpitaux/services lecture seule. `features/staff/day.component.ts` sert les deux rôles.

**Phase 8 — portail PATIENT** : layout **visuellement distinct** (`portal-shell`), dashboard, dossier imprimable (`styles/_print.scss`, bouton imprimer), rendez-vous + **stepper de demande** (`shared/ui/stepper`) : service → médecin → date/créneau → confirmation ; trouver un médecin, hôpitaux/services, bibliothèque de santé, assistant limité, profil. Aucune donnée d'un autre patient accessible (déjà gardé côté backend par `query-guard` + `publicize`).

**Phase 9 — outils intelligents** : assistant (puces langue / intent / confiance / entités, bloc SPARQL copiable, « ouvrir dans la console », export CSV, historique, puces d'exemples, dictée vocale optionnelle) ; console SPARQL (CodeMirror, modèles, Ctrl+Entrée, historique, requêtes enregistrées) ; explorateur d'ontologie (Cytoscape : arbre, focus/expand, layouts, légende, panneau de détail avec 4 onglets). Respecter la **UX QUALITY BAR** de PROMPT.md : états de chargement (`ui-skeleton`), états vides et erreurs typographiés, focus visible, navigation clavier, ARIA, responsive.

---

## 7. Phase 10 — tests, e2e, documentation, FINAL CHECKLIST

### 7.1 Tests
- Backend : `npm run test:api` (unit **106 passés** + intégration `auth-rbac`, `crud-materialization`, `nlp-ask`, `query-aggregation`) — tout doit rester vert.
- NLP : `npm run test:nlp` (pytest du `nlp-service`) + `npm run nlp:evaluate` pour alimenter `docs/nlp-evaluation.md`.
- Frontend unit : `npm run test:web` (karma/ChromeHeadless).
- **E2E Playwright : non installé.** À ajouter (`@playwright/test`, `npx playwright install chromium`) avec au minimum, PROMPT.md l'exige : connexion pour **chaque rôle**, création d'un patient, création d'un rendez-vous, question en langage naturel → SPARQL généré → résultats affichés. Scénarios sur le dataset isolé, jamais sur `medicare`.

### 7.2 Livrables documentaires (`docs/` est vide → tout est à écrire)
- `README.md` : diagramme **mermaid** de l'architecture, prérequis, variables d'env, chargement de l'ontologie, commandes d'installation/run, **comptes de démo** (rôles + mot de passe — reprendre `backend/scripts/demo-accounts.ts`, ne jamais inventer ni exposer un secret réel), **matrice de permissions** rôle × fonctionnalité, aperçu de l'API (`/api/docs`), dépannage.
- `docs/tools-used.md` : outils/bibliothèques et pourquoi, **section NLP/TALN détaillée** et mention explicite **« NO LLM API »** (pipeline à règles + lexique + classificateur local, appels SPARQL directs).
- `docs/sparql-examples.md` : **≥ 25 exemples** exécutables, préfixes réels, variants FR/EN.
- `docs/nlp-evaluation.md` : précision par intent, nombre de cas, methodology, limites.
- `docs/demo-script.md` : parcours de démo rôles par rôles, minuté.
- OpenAPI servi sur `/api/docs` (déjà câblé via `src/openapi.ts` + swagger-ui-express) → vérifier qu'il couvre les routes publiques, CRUD, auth, NLP, console.

### 7.3 FINAL CHECKLIST
Reprendre **la liste finale de `PROMPT.md`** point par point et cocher avec une preuve (commande + sortie, ou assertion DOM). Ne déclarer rien « terminé » sans l'avoir exécuté dans cette session.

---

## 8. Nettoyage à faire (scratch prouvé redondant, à supprimer **par son nom**)
```
frontend/scripts/tmp-errlist.cjs      (utile tant que le build n'est pas vert — le garder jusqu'à la fin de la Phase 4)
frontend/scripts/tmp-fix1.cjs  tmp-fix2.cjs  tmp-fix3.cjs
frontend/scripts/tmp-states-move.cjs  (déjà supprimé)
backend/scripts/tmp-contract.ts
backend/data/contract-check.json  openapi.tmp.json  contract.tmp.json
```
Avant suppression : vérifier que rien ne les référence (`grep -rn "tmp-" frontend/src backend/src`), lister les fichiers, puis supprimer uniquement ceux qui sont clairement des artefacts de cette session.

---

## 9. Ordre de travail recommandé (une phase = un arrêt de validation)
1. §5.2 → build à zéro erreur + i18n + CSS FullCalendar + karma → **compter rendu Phase 4**, s'arrêter.
2. Phases 5 → 6 → 7 → 8 → 9 : pour chacune, compiler, démarrer l'API + Fuseki + le service NLP, et **vérifier dans le navigateur avec `evaluate_script`** les parcours attendus du rôle concerné, puis rendre compte.
3. Phase 10 : Playwright + docs + FINAL CHECKLIST.
4. Supprimer le scratch, vérifier `git status`, proposer le commit (ne pas committer/pousser sans accord).

Démarrage complet de la pile :
```bash
npm run infra                      # Fuseki (docker)
npm run ontology                   # charge backend/ontology/*.ttl
npm run seed                       # lignes de démo (medicare dataset)
npm run nlp                        # service FastAPI :8100
npm run api                        # Express :4000
npm run web                        # Angular :4300 (lance npm run i18n avant de servir)
```
