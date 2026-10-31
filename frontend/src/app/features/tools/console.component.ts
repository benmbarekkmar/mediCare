import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  AfterViewInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { sparql as sparqlStreamMode } from '@codemirror/legacy-modes/mode/sparql';
import { tags } from '@lezer/highlight';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { ConsoleService, OntologyService } from '../../core/api/ontology.service';
import type { ClassNode, ConsoleReadResult, ConsoleUpdateResult, HierarchyPayload, OntologyStats, PropertyRow, ResultValue } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { UnsavedChangesService } from '../../core/auth/guards';
import { ToastService } from '../../core/toast/toast.service';
import { downloadCsv, downloadJson } from '../../core/util/csv';
import { formatDateTime, relativeTime } from '../../core/util/format';
import { problemOf } from '../../core/api/error.interceptor';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardActionsDirective, UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiCodeBlockComponent } from '../../shared/ui/code-block/ui-code-block.component';
import { UiConfirmDialogComponent } from '../../shared/ui/confirm-dialog/ui-confirm-dialog.component';
import { UiDropdownComponent, type DropdownItem } from '../../shared/ui/dropdown/ui-dropdown.component';
import { UiDropdownTriggerDirective } from '../../shared/ui/dropdown/ui-dropdown-trigger.directive';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import type { IconName } from '../../shared/ui/icon/icons';
import { UiIconButtonComponent } from '../../shared/ui/table/ui-icon-button.component';
import { UiPageActionsDirective } from '../../shared/ui/page-header/ui-page-actions.directive';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiPageMetaDirective } from '../../shared/ui/page-header/ui-page-meta.directive';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiTableComponent } from '../../shared/ui/table/ui-table.component';

/**
 * ADMIN SPARQL console: a CodeMirror editor over the guarded `/console` endpoints.
 * Reads run through `ConsoleService.run`, writes through `ConsoleService.update`
 * behind an explicit confirmation. Templates, vocabulary and the prefix block all
 * come from the ontology this back-end actually serves.
 */

/** The namespaces `backend/src/sparql/prefixes.ts` prepends to every statement. */
const NAMESPACES: readonly (readonly [string, string])[] = [
  ['ont', 'http://www.semanticweb.org/kmarb/ontologies/2026/8/medical-care-ontology#'],
  ['rdf', 'http://www.w3.org/1999-02-22-rdf-syntax-ns#'],
  ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'],
  ['owl', 'http://www.w3.org/2002/07/owl#'],
  ['skos', 'http://www.w3.org/2004/02/skos/core#'],
  ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
];

const PREFIX_BLOCK = NAMESPACES.map(([name, iri]) => `PREFIX ${name}: <${iri}>`).join('\n');

/** Terms the TBox asserts with, offered beside the live vocabulary. */
const FIXED_TERMS: readonly string[] = [
  'rdf:type',
  'rdfs:label',
  'rdfs:comment',
  'rdfs:subClassOf',
  'rdfs:domain',
  'rdfs:range',
  'owl:Class',
  'owl:ObjectProperty',
  'owl:DatatypeProperty',
  'owl:AnnotationProperty',
  'owl:NamedIndividual',
  'owl:equivalentClass',
  'owl:someValuesFrom',
  'owl:propertyChainAxiom',
  'skos:altLabel',
  'skos:prefLabel',
  'xsd:string',
  'xsd:integer',
  'xsd:decimal',
  'xsd:boolean',
  'xsd:date',
  'xsd:dateTime',
];

const KEYWORDS: readonly string[] = [
  'SELECT', 'DISTINCT', 'REDUCED', 'CONSTRUCT', 'DESCRIBE', 'ASK', 'WHERE', 'FILTER', 'OPTIONAL',
  'UNION', 'MINUS', 'BIND', 'AS', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'VALUES', 'GROUP',
  'HAVING', 'AGGREGATE', 'PREFIX', 'BASE', 'FROM', 'GRAPH', 'EXISTS', 'NOT EXISTS', 'IN', 'IS',
  'IRI', 'BNODE', 'STR', 'LANG', 'LANGMATCHES', 'DATATYPE', 'BOUND', 'SAMEAS', 'CONTAINS',
  'STRSTARTS', 'STRENDS', 'REGEX', 'REPLACE', 'STRLEN', 'UCASE', 'LCASE', 'CONCAT', 'COALESCE',
  'IF', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'SAMPLE', 'GROUP_CONCAT', 'SEPARATOR', 'NOW', 'YEAR',
  'MONTH', 'DAY', 'HOURS', 'MINUTES', 'SECONDS', 'TIMEZONE', 'RAND', 'ABS', 'CEIL', 'FLOOR',
  'ROUND', 'MD5', 'SHA1', 'UUID', 'STRUUID', 'ENCODE_FOR_URI', 'INSERT', 'DELETE', 'DATA', 'WITH',
];

const LIMIT_OPTIONS = [20, 50, 100, 200, 500] as const;
const HISTORY_KEY = 'medicare.console.history';
const SAVED_KEY = 'medicare.console.saved';
const LIMIT_KEY = 'medicare.console.limit';
const HISTORY_MAX = 20;
const SAVED_MAX = 30;

type StatementKind = 'select' | 'ask' | 'construct' | 'describe' | 'update' | 'empty';

interface ConsoleEntry {
  readonly query: string;
  readonly at: string;
  readonly ok: boolean;
}

interface SavedQuery {
  readonly name: string;
  readonly query: string;
  readonly at: string;
}

interface ConsoleTemplate {
  readonly id: string;
  readonly group: 'reads' | 'writes';
  readonly icon: IconName;
  readonly body: string;
}

/** Real statements against this ontology: `ont:` classes, predicates and data fields. */
const CONSOLE_TEMPLATES: readonly ConsoleTemplate[] = [
  {
    id: 'patients',
    group: 'reads',
    icon: 'users',
    body: `SELECT ?patient ?name ?age
WHERE {
  ?patient a ont:Patient ;
           ont:hasName ?name ;
           ont:hasAge ?age .
}
ORDER BY ?name
LIMIT 20`,
  },
  {
    id: 'filter_contains',
    group: 'reads',
    icon: 'filter',
    body: `SELECT ?patient ?name ?age ?bloodType
WHERE {
  ?patient a ont:Patient ;
           ont:hasName ?name ;
           ont:hasAge ?age .
  OPTIONAL { ?patient ont:hasBloodType ?bloodType }
  FILTER(CONTAINS(LCASE(?name), "ben") || ?age >= 65)
}
ORDER BY DESC(?age)
LIMIT 30`,
  },
  {
    id: 'counts',
    group: 'reads',
    icon: 'chart-column',
    body: `SELECT ?diseaseName (COUNT(DISTINCT ?patient) AS ?patients)
WHERE {
  ?patient a ont:Patient ;
           ont:hasDisease ?disease .
  ?disease ont:diseaseName ?diseaseName .
}
GROUP BY ?disease ?diseaseName
ORDER BY DESC(?patients)`,
  },
  {
    id: 'group_concat',
    group: 'reads',
    icon: 'list-checks',
    body: `SELECT ?diseaseName
        (GROUP_CONCAT(DISTINCT ?symptomName; SEPARATOR=", ") AS ?symptoms)
        (COUNT(DISTINCT ?symptom) AS ?symptomCount)
WHERE {
  ?disease ont:diseaseName ?diseaseName ;
           ont:hasSymptom ?symptom .
  ?symptom ont:symptomName ?symptomName .
}
GROUP BY ?disease ?diseaseName
ORDER BY DESC(?symptomCount)`,
  },
  {
    id: 'ask',
    group: 'reads',
    icon: 'circle-help',
    body: `ASK WHERE {
  ?disease ont:diseaseName "Diabetes" ;
           ont:hasSymptom ?symptom .
  ?symptom ont:symptomName "Fever" .
}`,
  },
  {
    id: 'construct',
    group: 'reads',
    icon: 'network',
    body: `CONSTRUCT {
  ?disease ont:hasSymptom ?symptom .
  ?symptom ont:symptomName ?symptomName .
}
WHERE {
  ?disease a ont:Disease ;
           ont:hasSymptom ?symptom .
  ?symptom ont:symptomName ?symptomName .
}
LIMIT 40`,
  },
  {
    id: 'describe',
    group: 'reads',
    icon: 'eye',
    body: `DESCRIBE ?patient WHERE {
  ?patient ont:hasName "Ahmed Ben Ali" .
}`,
  },
  {
    id: 'latest_tests',
    group: 'reads',
    icon: 'flask',
    body: `SELECT ?testDate ?result ?patientName ?type
WHERE {
  ?test a ont:MedicalTest ;
        ont:testDate ?testDate ;
        ont:testResult ?result ;
        ont:isTestOf ?patient .
  ?patient ont:hasName ?patientName .
  OPTIONAL { ?test rdf:type ?type FILTER(?type != ont:MedicalTest) }
}
ORDER BY DESC(?testDate)
LIMIT 15`,
  },
  {
    id: 'symptom_to_disease',
    group: 'reads',
    icon: 'activity',
    body: `SELECT ?symptomName ?diseaseName ?treatmentName
WHERE {
  ?symptom ont:symptomName ?symptomName ;
           ont:isSymptomOf ?disease .
  ?disease ont:diseaseName ?diseaseName ;
           ont:hasTreatment ?treatment .
  ?treatment ont:treatmentName ?treatmentName .
  FILTER(REGEX(STR(?symptomName), "pain|fever|rash", "i"))
}
ORDER BY ?symptomName ?diseaseName`,
  },
  {
    id: 'doctor_chain',
    group: 'reads',
    icon: 'waypoints',
    body: `SELECT ?doctorName ?specialty ?departmentName ?hospitalName
WHERE {
  VALUES ?specialty {
    ont:Cardiologist ont:Neurologist ont:Dermatologist
    ont:GeneralPractitioner ont:EmergencyPhysician
  }
  ?doctor ont:doctorName ?doctorName ;
          ont:doctorLicenseNumber ?license ;
          rdf:type ?specialty ;
          ont:worksIn ?department .
  ?department ont:departmentName ?departmentName ;
              ont:locatedIn ?hospital .
  ?hospital ont:hospitalName ?hospitalName .
}
ORDER BY ?hospitalName ?departmentName ?doctorName`,
  },
  {
    id: 'path_rollup',
    group: 'reads',
    icon: 'git-branch',
    body: `SELECT ?className (COUNT(DISTINCT ?individual) AS ?individuals)
WHERE {
  ?class rdfs:subClassOf* ?className .
  ?individual rdf:type ?class .
}
GROUP BY ?className
ORDER BY DESC(?individuals)`,
  },
  {
    id: 'path_chain',
    group: 'reads',
    icon: 'route',
    body: `SELECT DISTINCT ?diseaseName ?medicationName ?dosage
WHERE {
  ?disease a ont:Disease ;
           ont:diseaseName ?diseaseName ;
           ont:hasTreatment/ont:usesMedication ?medication .
  ?medication ont:medicationName ?medicationName .
  OPTIONAL { ?medication ont:medicationDosage ?dosage }
}
ORDER BY ?diseaseName ?medicationName
LIMIT 30`,
  },
  {
    id: 'optional_age',
    group: 'reads',
    icon: 'heart',
    body: `SELECT ?patientName ?age ?phone
WHERE {
  ?patient a ont:Patient ;
           ont:hasName ?patientName .
  OPTIONAL { ?patient ont:hasAge ?age }
  OPTIONAL { ?patient ont:hasPhoneNumber ?phone }
  FILTER(BOUND(?age) && ?age < 18)
}
ORDER BY ?age`,
  },
  {
    id: 'write_insert',
    group: 'writes',
    icon: 'plus',
    body: `INSERT DATA {
  ont:Migraine skos:altLabel "hemic headache"@en .
}`,
  },
  {
    id: 'write_delete',
    group: 'writes',
    icon: 'trash',
    body: `DELETE WHERE {
  ont:Migraine skos:altLabel ?stale .
  FILTER(LANG(?stale) = "en")
}`,
  },
  {
    id: 'write_delete_insert',
    group: 'writes',
    icon: 'pencil',
    body: `DELETE { ont:Patient_Ahmed ont:hasPhoneNumber ?current }
INSERT { ont:Patient_Ahmed ont:hasPhoneNumber "215550110" }
WHERE {
  ont:Patient_Ahmed ont:hasPhoneNumber ?current .
}`,
  },
];

const DEFAULT_TEMPLATE = CONSOLE_TEMPLATES[0];

/** Declarations never decide the form: the guard strips them before it looks. */
const DECLARATION = /^\s*(PREFIX|BASE)\b/i;
const UPDATE_START = /^\s*(INSERT|DELETE)\b/i;

const stripDeclarations = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !DECLARATION.test(line))
    .join('\n')
    .trim();

const statementKindOf = (text: string): StatementKind => {
  const head = stripDeclarations(text);
  if (!head) return 'empty';
  if (UPDATE_START.test(head)) return 'update';
  const word = /^\s*(\w+)/.exec(head)?.[1]?.toLowerCase() ?? '';
  if (word === 'ask') return 'ask';
  if (word === 'construct' || word === 'describe') return 'construct';
  if (word === 'select') return 'select';
  return 'empty';
};

/** Collapses a statement into a single readable line for the chip lists. */
const chipLabel = (query: string): string => {
  const flat = query.replace(/\s+/g, ' ').trim();
  return flat.length <= 52 ? flat : `${flat.slice(0, 52)}…`;
};

const isEntry = (value: unknown): value is ConsoleEntry =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ConsoleEntry).query === 'string' &&
  typeof (value as ConsoleEntry).at === 'number' === false &&
  typeof (value as ConsoleEntry).at === 'string';

const isSaved = (value: unknown): value is SavedQuery =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SavedQuery).query === 'string' &&
  typeof (value as SavedQuery).name === 'string' &&
  typeof (value as SavedQuery).at === 'string';

const readList = <T>(key: string, isType: (value: unknown) => value is T, max: number): T[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isType).slice(0, max);
  } catch {
    return [];
  }
};

const writeList = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the console simply forgets the list */
  }
};

const readLimit = (fallback: number): number => {
  try {
    const stored = Number(localStorage.getItem(LIMIT_KEY));
    return LIMIT_OPTIONS.some((option) => option === stored) ? stored : fallback;
  } catch {
    return fallback;
  }
};

const countTriples = (ntriples: string): number =>
  ntriples
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .length;

/** Numbers compare as numbers, everything else as text; unbound cells sort last. */
const compareCells = (left: unknown, right: unknown, order: 'asc' | 'desc'): number => {
  const a = left === null || left === undefined ? '' : String(left);
  const b = right === null || right === undefined ? '' : String(right);
  if (a === '' && b === '') return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  const an = Number(a);
  const bn = Number(b);
  const numeric = a.trim() !== '' && b.trim() !== '' && Number.isFinite(an) && Number.isFinite(bn);
  const base = numeric ? an - bn : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  if (base === 0) return 0;
  return order === 'asc' ? base : -base;
};

const sparqlLanguage = StreamLanguage.define(sparqlStreamMode);

/** Colours come from the design tokens, so light and dark themes both hold. */
const sparqlHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--primary)', fontWeight: '650' },
  { tag: tags.operatorKeyword, color: 'var(--primary)', fontWeight: '650' },
  { tag: tags.variableName, color: 'var(--accent)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--danger-700)' },
  { tag: tags.number, color: 'var(--warning-700)' },
  { tag: tags.bool, color: 'var(--warning-700)' },
  { tag: tags.comment, color: 'var(--text-subtle)', fontStyle: 'italic' },
  { tag: tags.typeName, color: 'var(--secondary)' },
  { tag: tags.className, color: 'var(--secondary)' },
  { tag: tags.literal, color: 'var(--secondary)' },
  { tag: tags.operator, color: 'var(--text-muted)' },
  { tag: tags.punctuation, color: 'var(--text-muted)' },
]);

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--surface-alt)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-input)',
    fontSize: 'var(--fs-sm)',
    height: 'min(48vh, 420px)',
  },
  '&.cm-focused': { outline: 'none', boxShadow: 'var(--focus-ring)', borderColor: 'var(--primary)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--text)', padding: 'var(--sp-2) 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-subtle)',
    border: '0',
    borderInlineEnd: '1px solid var(--border)',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--text-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--sp-2)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--primary-soft)' },
  '.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--primary-soft)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-input)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-xs)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--text)',
  },
});

@Component({
  selector: 'page-console',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    UiAlertComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiCardComponent,
    UiCardActionsDirective,
    UiCodeBlockComponent,
    UiConfirmDialogComponent,
    UiDropdownComponent,
    UiDropdownTriggerDirective,
    UiEmptyStateComponent,
    UiErrorStateComponent,
    UiIconComponent,
    UiIconButtonComponent,
    UiPageActionsDirective,
    UiPageHeaderComponent,
    UiPageMetaDirective,
    UiSkeletonComponent,
    UiTableComponent,
  ],
  template: `
    <div class="page console">
      <ui-page-header [title]="'console.title' | translate" [subtitle]="subtitle()" icon="terminal">
        <ng-template uiPageActions>
          <ui-button variant="outline" size="sm" icon="download" [disabled]="!hasRows()" (click)="exportCsv()">
            {{ 'common.export' | translate }}
          </ui-button>
          <ui-button variant="outline" size="sm" icon="braces" [disabled]="!result()" (click)="exportJson()">
            {{ 'console.exportJson' | translate }}
          </ui-button>
        </ng-template>
        <ng-template uiPageMeta>
          @if (!canWrite()) {
            <ui-badge kind="warning" [label]="('console.readOnlyRole' | translate)"></ui-badge>
          }
        </ng-template>
      </ui-page-header>

      <ui-card [title]="'console.editor.title' | translate" [subtitle]="statementHint()" icon="terminal">
        <ng-template uiCardActions>
          <div class="toolbar">
            <ui-dropdown
              [items]="templateItems()"
              align="end"
              [menuLabel]="('console.templates' | translate)"
              (itemSelect)="chooseTemplate($event)"
            >
              <span trigger>
                <ui-icon name="file-text" [size]="14" />
                <span>{{ 'console.templates' | translate }}</span>
              </span>
            </ui-dropdown>
            <ui-dropdown
              [items]="limitItems()"
              align="end"
              [menuLabel]="('console.limit' | translate)"
              (itemSelect)="chooseLimit($event)"
            >
              <span trigger>
                <ui-icon name="sliders" [size]="14" />
                <span>{{ 'console.limit' | translate }}: {{ limit() }}</span>
              </span>
            </ui-dropdown>
          </div>
        </ng-template>

        <div class="editor-shell">
          <div #editorHost class="editor" tabindex="-1" [attr.aria-label]="'console.editor.aria' | translate"></div>

          <div class="editor-foot">
            <div class="row">
              <ui-button icon="zap" [loading]="loading()" [disabled]="isEmpty()" (click)="execute()">
                {{ 'console.run' | translate }}
              </ui-button>
              <ui-button variant="outline" icon="save" [disabled]="isEmpty()" (click)="saveCurrent()">
                {{ 'console.saveQuery' | translate }}
              </ui-button>
              <ui-button variant="ghost" icon="x" [disabled]="isEmpty()" (click)="clearEditor()">
                {{ 'common.clear' | translate }}
              </ui-button>
              <span class="spacer"></span>
              <span class="kbd-hint text-xs">
                <span class="kbd">Ctrl</span> + <span class="kbd">Enter</span>
                <span>{{ 'console.runShortcut' | translate }}</span>
              </span>
            </div>
            @if (dirty()) {
              <p class="hint text-xs">{{ 'console.editor.dirty' | translate }}</p>
            }
            <p class="hint text-xs">{{ 'console.guard.hint' | translate }}</p>
          </div>
        </div>
      </ui-card>

      @if (updateSummary(); as summary) {
        <ui-alert kind="success" icon="circle-check" [dismissible]="true" [title]="summary.title" (dismissed)="dismissUpdate()">
          {{ summary.body }}
        </ui-alert>
      }

      <ui-card [title]="'console.results.title' | translate" [subtitle]="resultSubtitle()" icon="table">
        <div class="result-block" aria-live="polite">
          @if (loading()) {
            <ui-skeleton height="220px" [radius]="'var(--radius-card)'"></ui-skeleton>
          } @else if (failure()) {
            <ui-error-state
              [title]="'console.results.errorTitle' | translate"
              [message]="failure() ?? ''"
              [hint]="'console.results.errorHint' | translate"
              (retry)="retry()"
            />
          } @else if (result()) {
            @if (result(); as res) {
            @if (res.form === 'ask') {
              <div class="answer" [class]="res.answer ? 'answer answer--yes' : 'answer answer--no'">
                <ui-icon [name]="res.answer ? 'circle-check' : 'circle-x'" [size]="28" />
                <div class="answer__text">
                  <p class="answer__value">{{ res.answer ? ('console.ask.yes' | translate) : ('console.ask.no' | translate) }}</p>
                  <p class="hint text-xs">{{ 'console.ask.hint' | translate: { ms: res.executionMs } }}</p>
                </div>
              </div>
            } @else if (res.form === 'construct') {
              <p class="hint text-xs">{{ 'console.results.graph' | translate: { triples: tripleCount(res.ntriples ?? '') } }}</p>
              <ui-code-block
                language="ttl"
                [code]="res.ntriples ?? ''"
                [label]="('console.results.ntriples' | translate)"
                [copyable]="true"
                [wrap]="true"
                [maxHeight]="'360px'"
              />
            } @else if (tableRows().length > 0) {
              <ui-table
                [columns]="columns()"
                [rows]="pagedRows()"
                [total]="tableRows().length"
                [sort]="sort()"
                [page]="page()"
                [pageSize]="pageSize()"
                [trackId]="'rowIndex'"
                columnsId="sparql-console"
                [emptyTitle]="'console.results.empty' | translate"
                [actionsLabel]="'common.actions' | translate"
                (sortChange)="onSort($event)"
                (pageChange)="onPage($event)"
                (pageSizeChange)="onPageSize($event)"
              ></ui-table>
            } @else {
              <ui-empty-state icon="inbox" [title]="'console.results.empty' | translate" [hint]="'console.results.emptyHint' | translate">
                <ui-button variant="outline" size="sm" icon="refresh" (click)="retry()">
                  {{ 'common.retry' | translate }}
                </ui-button>
              </ui-empty-state>
            }

            @if (capped()) {
              <p class="hint text-xs">{{ 'console.results.capped' | translate: { limit: limit() } }}</p>
            }

            <div class="query-block">
              <button type="button" class="collapse" [attr.aria-expanded]="executedOpen()" (click)="toggleExecuted()">
                <ui-icon [name]="executedOpen() ? 'chevron-down' : 'chevron-right'" [size]="16" />
                {{ 'console.results.executed' | translate }}
              </button>
              @if (executedOpen()) {
                <ui-code-block
                  language="sparql"
                  [code]="res.query"
                  [label]="('console.results.executed' | translate)"
                  [copyable]="true"
                  [wrap]="true"
                  [maxHeight]="'260px'"
                />
              }
            </div>
            }
          } @else {
            <ui-empty-state icon="terminal" [title]="'console.results.idle' | translate" [hint]="'console.results.idleHint' | translate">
              <ui-button icon="zap" (click)="execute()">{{ 'console.run' | translate }}</ui-button>
            </ui-empty-state>
          }
        </div>
      </ui-card>

      <div class="lists">
        <ui-card [title]="'console.history.title' | translate" [subtitle]="historySubtitle()" icon="clock">
          <ng-template uiCardActions>
            @if (history().length > 0) {
              <ui-button variant="ghost" size="sm" icon="trash" (click)="clearHistory()">
                {{ 'console.history.clear' | translate }}
              </ui-button>
            }
          </ng-template>
          @if (history().length === 0) {
            <p class="hint text-xs">{{ 'console.history.empty' | translate }}</p>
          } @else {
            <ul class="chips" role="list">
              @for (entry of history(); track entry.query) {
                <li class="chip">
                  <button type="button" class="chip__main" [title]="fullTitle(entry)" (click)="useQuery(entry.query)">
                    <ui-icon [name]="entry.ok ? 'circle-check' : 'triangle-alert'" [size]="13" [class]="entry.ok ? 'ok' : 'fail'" />
                    <span class="chip__text">{{ chip(entry.query) }}</span>
                    <span class="chip__time">{{ since(entry.at) }}</span>
                  </button>
                  <ui-icon-button
                    icon="x"
                    [label]="'console.list.remove' | translate"
                    (click)="dropHistory(entry.query)"
                  ></ui-icon-button>
                </li>
              }
            </ul>
          }
        </ui-card>

        <ui-card [title]="'console.saved.title' | translate" [subtitle]="savedSubtitle()" icon="save">
          <ng-template uiCardActions>
            @if (saved().length > 0) {
              <ui-button variant="ghost" size="sm" icon="trash" (click)="clearSaved()">
                {{ 'console.history.clear' | translate }}
              </ui-button>
            }
          </ng-template>
          @if (saved().length === 0) {
            <p class="hint text-xs">{{ 'console.saved.empty' | translate }}</p>
          } @else {
            <ul class="chips" role="list">
              @for (item of saved(); track item.query) {
                <li class="chip">
                  <button type="button" class="chip__main" [title]="item.query" (click)="useQuery(item.query)">
                    <ui-icon name="tag" [size]="13" />
                    <span class="chip__text">{{ item.name }}</span>
                    <span class="chip__time">{{ since(item.at) }}</span>
                  </button>
                  <ui-icon-button
                    icon="x"
                    [label]="'console.list.remove' | translate"
                    (click)="dropSaved(item.query)"
                  ></ui-icon-button>
                </li>
              }
            </ul>
          }
        </ui-card>
      </div>

      <section class="surface prefixes">
        <button type="button" class="collapse" [attr.aria-expanded]="prefixesOpen()" (click)="togglePrefixes()">
          <ui-icon [name]="prefixesOpen() ? 'chevron-down' : 'chevron-right'" [size]="16" />
          {{ 'console.prefixes.title' | translate }}
        </button>
        @if (prefixesOpen()) {
          <p class="hint text-xs">{{ 'console.prefixes.hint' | translate }}</p>
          <ui-code-block language="sparql" [code]="prefixBlock" [copyable]="true" [wrap]="true" [maxHeight]="'220px'" />
          <p class="hint text-xs">{{ 'console.prefixes.compact' | translate }}</p>
        }
      </section>

      <ui-confirm-dialog
        [open]="updateOpen()"
        (openChange)="updateOpen.set($event)"
        [title]="'console.update.title' | translate"
        [message]="updateMessage()"
        [confirmLabel]="('console.update.confirm' | translate)"
        [danger]="true"
        [busy]="applying()"
        (confirmed)="runUpdate()"
      />

      <ui-confirm-dialog
        [open]="templateOpen()"
        (openChange)="templateOpen.set($event)"
        [title]="'console.template.title' | translate"
        [message]="('console.template.message' | translate)"
        [confirmLabel]="('console.template.confirm' | translate)"
        [danger]="false"
        [busy]="false"
        (confirmed)="applyPendingTemplate()"
      />
    </div>
  `,
  styles: [
    `
      .console {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .toolbar,
      .result-block,
      .editor-shell {
        min-width: 0;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
      }
      .editor-shell {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }
      .editor {
        width: 100%;
        min-width: 0;
        overflow: hidden;
        border-radius: var(--radius-input);
      }
      .editor-foot {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .hint {
        margin: 0;
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .text-xs {
        font-size: var(--fs-xs);
      }
      .kbd-hint {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        color: var(--text-subtle);
      }
      .kbd {
        font-family: var(--font-mono);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-input);
        background: var(--surface-alt);
        color: var(--text-muted);
        padding: 0 var(--sp-1);
      }
      .result-block {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
      }
      .answer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-3);
        padding: var(--sp-3) var(--sp-4);
        border: 1px solid var(--border);
        border-inline-start: var(--sp-1) solid var(--primary);
        border-radius: var(--radius-card);
        background: var(--surface-alt);
      }
      .answer--yes {
        border-inline-start-color: var(--success-500);
      }
      .answer--no {
        border-inline-start-color: var(--danger-500);
      }
      .answer__text {
        min-width: 0;
      }
      .answer__value {
        margin: 0;
        font-size: var(--fs-lg);
        font-weight: 600;
        color: var(--text);
      }
      .query-block {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .collapse {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        align-self: flex-start;
        padding: var(--sp-1) var(--sp-2);
        border: 0;
        border-radius: var(--radius-input);
        background: transparent;
        color: var(--primary);
        font: inherit;
        font-size: var(--fs-sm);
        font-weight: 600;
        cursor: pointer;
      }
      .collapse:hover {
        color: var(--primary-hover);
        background: var(--bg-hover);
      }
      .collapse:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .lists {
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .chip {
        display: flex;
        align-items: center;
        max-width: 100%;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-pill);
        background: var(--surface);
        overflow: hidden;
      }
      .chip__main {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        min-width: 0;
        padding: var(--sp-1) var(--sp-2);
        border: 0;
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: var(--fs-xs);
        text-align: start;
        cursor: pointer;
      }
      .chip__main:hover {
        color: var(--primary);
        background: var(--bg-hover);
      }
      .chip__main:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .chip__text {
        min-width: 0;
        max-width: min(240px, 55vw);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip__time {
        flex: none;
        color: var(--text-subtle);
      }
      .ok {
        color: var(--success-500);
      }
      .fail {
        color: var(--danger-500);
      }
      .prefixes {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        padding: var(--sp-3) var(--sp-4);
      }
    `,
  ],
})
export class ConsoleComponent implements AfterViewInit {
  private readonly console = inject(ConsoleService);
  private readonly ontology = inject(OntologyService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly editorHost = viewChild.required<ElementRef<HTMLDivElement>>('editorHost');
  private view: EditorView | null = null;
  private handedOff = '';

  protected readonly prefixBlock = PREFIX_BLOCK;

  readonly loading = signal(false);
  readonly applying = signal(false);
  readonly result = signal<ConsoleReadResult | null>(null);
  readonly failure = signal<string | null>(null);
  readonly editorText = signal('');
  readonly baseline = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly sort = signal<{ field: string; order: 'asc' | 'desc' } | null>(null);
  readonly limit = signal(readLimit(100));
  readonly history = signal<ConsoleEntry[]>(readList(HISTORY_KEY, isEntry, HISTORY_MAX));
  readonly saved = signal<SavedQuery[]>(readList(SAVED_KEY, isSaved, SAVED_MAX));
  readonly storeTriples = signal<number | null>(null);
  readonly updateResult = signal<ConsoleUpdateResult | null>(null);
  readonly executedOpen = signal(false);
  readonly prefixesOpen = signal(false);
  readonly updateOpen = signal(false);
  readonly templateOpen = signal(false);
  readonly canWrite = computed(() => this.auth.hasRole('ADMIN'));

  private readonly pendingUpdate = signal<string | null>(null);
  private readonly pendingTemplate = signal<string | null>(null);
  private readonly failedStatement = signal<string | null>(null);
  private readonly lastRead = signal<string | null>(null);
  private readonly vocabulary = signal<string[]>([]);

  readonly isEmpty = computed(() => this.editorText().trim().length === 0);
  readonly dirty = computed(() => {
    const text = this.editorText();
    return text.trim().length > 0 && text !== this.baseline();
  });
  readonly statementKind = computed<StatementKind>(() => statementKindOf(this.editorText()));

  readonly subtitle = computed<string | null>(() => {
    const triples = this.storeTriples();
    if (triples === null) return null;
    return this.translate.instant('console.subtitle', { triples: triples.toLocaleString() });
  });

  readonly statementHint = computed(() => this.translate.instant(`console.statement.${this.statementKind()}`));

  readonly hasRows = computed(() => this.tableRows().length > 0);

  readonly columns = computed(() =>
    (this.result()?.vars ?? []).map((name) => ({
      field: name,
      header: `?${name}`,
      sortable: true,
      width: 'min(260px, 45%)',
    })),
  );

  /** Result bindings are `{ value, type }` cells: flatten them into display strings. */
  readonly tableRows = computed<Record<string, unknown>[]>(() => {
    const res = this.result();
    if (!res || res.form !== 'select') return [];
    const vars = res.vars ?? [];
    const rows = (res.rows ?? []).map((row, index) => {
      const cells: Record<string, unknown> = { rowIndex: String(index) };
      for (const name of vars) cells[name] = this.cellText(row[name]);
      return cells;
    });
    const state = this.sort();
    if (!state) return rows;
    return [...rows].sort((a, b) => compareCells(a[state.field], b[state.field], state.order));
  });

  readonly pagedRows = computed(() => {
    const rows = this.tableRows();
    const size = this.pageSize();
    const start = (this.page() - 1) * size;
    return rows.slice(start, start + size);
  });

  readonly resultSubtitle = computed<string | null>(() => {
    const res = this.result();
    if (!res) return null;
    if (res.form === 'select') {
      return this.translate.instant('console.results.meta', {
        rows: res.count ?? res.rows?.length ?? 0,
        ms: res.executionMs,
      });
    }
    if (res.form === 'construct') {
      return this.translate.instant('console.results.metaGraph', {
        triples: countTriples(res.ntriples ?? ''),
        ms: res.executionMs,
      });
    }
    return this.translate.instant('console.results.metaAsk', { ms: res.executionMs });
  });

  readonly capped = computed(() => {
    const res = this.result();
    return res?.form === 'select' && (res.rows?.length ?? 0) >= this.limit();
  });

  readonly templateItems = computed<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];
    for (const group of ['reads', 'writes'] as const) {
      if (items.length > 0) items.push({ id: `sep-${group}`, label: '', separator: true });
      items.push({
        id: `group-${group}`,
        label: this.translate.instant(`console.groups.${group}`),
        disabled: true,
      });
      for (const tpl of CONSOLE_TEMPLATES.filter((item) => item.group === group)) {
        items.push({ id: tpl.id, label: this.translate.instant(`console.tpl.${tpl.id}`), icon: tpl.icon });
      }
    }
    return items;
  });

  readonly limitItems = computed(() =>
    LIMIT_OPTIONS.map((value) => ({
      id: String(value),
      label: this.translate.instant('console.limitValue', { value }),
      icon: value === this.limit() ? ('check' as const) : undefined,
    })),
  );

  readonly updateSummary = computed<{ title: string; body: string } | null>(() => {
    const res = this.updateResult();
    if (!res) return null;
    return {
      title: this.translate.instant('console.update.done', { operations: res.operations.length }),
      body: this.translate.instant('console.update.detail', {
        operations: res.operations.join(' · '),
        triples: res.triples.toLocaleString(),
        ms: this.updateMs(res),
      }),
    };
  });

  constructor() {
    this.loadVocabulary();
    this.ontology
      .stats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats: OntologyStats) => this.storeTriples.set(stats.triples),
        error: () => this.storeTriples.set(null),
      });

    // the assistant hands a generated query over through ?sparql=…
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const handed = params.get('sparql');
      if (!handed || handed === this.handedOff) return;
      this.handedOff = handed;
      this.applyText(handed);
      this.toast.info(this.translate.instant('console.handoff'));
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { sparql: null },
        queryParamsHandling: 'merge',
      });
    });
  }

  ngAfterViewInit(): void {
    this.createEditor();
    this.applyText(this.editorText());
  }

  // ---------------------------------------------------------------- editor ---

  private createEditor(): void {
    const view = new EditorView({
      parent: this.editorHost().nativeElement,
      doc: DEFAULT_TEMPLATE.body,
      extensions: [
        editorTheme,
        syntaxHighlighting(sparqlHighlight, { fallback: true }),
        sparqlLanguage.extension,
        indentUnit.of('  '),
        bracketMatching(),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        closeBrackets(),
        autocompletion({ override: [this.completions], activateOnTyping: true }),
        EditorView.lineWrapping,
        placeholder(this.translate.instant('console.editor.placeholder')),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              this.zone.run(() => this.execute());
              return true;
            },
            preventDefault: true,
          },
        ]),
        keymap.of(closeBracketsKeymap),
        keymap.of(defaultKeymap),
        keymap.of(completionKeymap),
        keymap.of(historyKeymap),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          this.zone.run(() => this.editorText.set(text));
        }),
      ],
    });
    this.view = view;
    this.editorText.set(DEFAULT_TEMPLATE.body);
    this.baseline.set(DEFAULT_TEMPLATE.body);
    this.destroyRef.onDestroy(() => view.destroy());
  }

  /** Vocabulary of the live ontology plus the variables already typed. */
  private readonly completions = (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/[$?][\w.-]*|[A-Za-z_][\w.-]*/);
    if (!match && !context.explicit) return null;
    const options: Completion[] = KEYWORDS.map((label) => ({ label, type: 'keyword', detail: 'SPARQL' }));
    for (const [name] of NAMESPACES) {
      options.push({ label: `${name}:`, type: 'prefix', detail: name });
    }
    for (const term of FIXED_TERMS) {
      options.push({ label: term, type: 'term', detail: 'RDF/OWL' });
    }
    for (const term of this.vocabulary()) {
      options.push({ label: term, type: 'ontology', info: this.translate.instant('console.completions.ontology') });
    }
    for (const variable of this.variablesInEditor()) {
      options.push({ label: variable, type: 'variable' });
    }
    return { from: match ? match.from : context.pos, options, validFor: /^[\w.:$?-]*$/ };
  };

  private variablesInEditor(): string[] {
    const found = new Set<string>();
    for (const match of this.editorText().matchAll(/[?$]([A-Za-z_]\w*)/g)) {
      const name = match[1];
      if (name) found.add(`?${name}`);
    }
    return [...found];
  }

  private loadVocabulary(): void {
    let terms: string[] = [];
    const collect = (node: ClassNode): void => {
      terms.push(`ont:${node.id}`);
      node.children.forEach(collect);
    };
    this.ontology
      .hierarchy()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (payload: HierarchyPayload) => {
          terms = [];
          payload.classes.forEach(collect);
          payload.static.forEach(collect);
          this.vocabulary.update((current) => [...new Set([...current, ...terms])]);
        },
        error: () => undefined,
      });
    this.ontology
      .properties()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows: PropertyRow[]) => {
          this.vocabulary.update((current) => [
            ...new Set([...current, ...rows.map((row) => `ont:${row.name}`), ...terms]),
          ]);
        },
        error: () => undefined,
      });
  }

  private applyText(text: string): void {
    this.editorText.set(text);
    this.baseline.set(text);
    const view = this.view;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: 0 },
    });
    view.focus();
  }

  protected clearEditor(): void {
    this.applyText('');
  }

  // -------------------------------------------------------------- templates ---

  chooseTemplate(item: DropdownItem): void {
    if (item.disabled === true || item.separator) return;
    const tpl = CONSOLE_TEMPLATES.find((candidate) => candidate.id === item.id);
    if (!tpl) return;
    if (this.dirty()) {
      this.pendingTemplate.set(tpl.body);
      this.templateOpen.set(true);
      return;
    }
    this.applyText(tpl.body);
  }

  applyPendingTemplate(): void {
    const body = this.pendingTemplate();
    this.pendingTemplate.set(null);
    this.templateOpen.set(false);
    if (body) this.applyText(body);
  }

  chooseLimit(item: DropdownItem): void {
    const value = Number(item.id);
    if (!LIMIT_OPTIONS.some((option) => option === value)) return;
    this.limit.set(value);
    try {
      localStorage.setItem(LIMIT_KEY, String(value));
    } catch {
      /* the choice simply is not remembered */
    }
  }

  togglePrefixes(): void {
    this.prefixesOpen.update((open) => !open);
  }

  toggleExecuted(): void {
    this.executedOpen.update((open) => !open);
  }

  // ------------------------------------------------------------------- run ---

  execute(): void {
    const text = this.editorText().trim();
    if (!text || this.loading() || this.applying()) return;
    if (statementKindOf(text) === 'update') {
      if (!this.canWrite()) {
        this.toast.warning(this.translate.instant('console.readOnlyRole'));
        return;
      }
      this.pendingUpdate.set(text);
      this.updateOpen.set(true);
      return;
    }
    this.runRead(text);
  }

  retry(): void {
    const failed = this.failedStatement();
    if (failed) this.runRead(failed);
  }

  private runRead(query: string): void {
    this.loading.set(true);
    this.failure.set(null);
    this.failedStatement.set(null);
    this.page.set(1);
    this.sort.set(null);
    this.console.run(query, this.limit()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.result.set(res);
        this.lastRead.set(query);
        this.baseline.set(query === this.editorText().trim() ? query : this.baseline());
        this.pushHistory(query, true);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        const message = apiProblemMessage(error, this.translate);
        this.failure.set(message);
        this.failedStatement.set(query);
        this.pushHistory(query, false);
        this.toast.error(this.translate.instant('console.results.errorTitle'), message);
      },
    });
  }

  updateMessage(): string {
    const pending = this.pendingUpdate() ?? '';
    const operations = pending.replace(/\s+/g, ' ').trim();
    const verb = /^\s*(INSERT\s+DATA|DELETE\s+WHERE|INSERT|DELETE)/i.exec(operations)?.[1]?.toUpperCase() ?? 'UPDATE';
    return this.translate.instant('console.update.message', {
      operation: verb,
      statement: operations.length > 240 ? `${operations.slice(0, 240)}…` : operations,
    });
  }

  runUpdate(): void {
    const statement = this.pendingUpdate();
    if (!statement || this.applying()) return;
    this.applying.set(true);
    this.console.update(statement).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.applying.set(false);
        this.updateOpen.set(false);
        this.pendingUpdate.set(null);
        this.updateResult.set(res);
        this.storeTriples.set(res.triples);
        this.pushHistory(statement, true);
        this.toast.success(this.translate.instant('console.update.done', { operations: res.operations.length }));
        // the store moved: re-run the last read so the panel shows the new truth
        const last = this.lastRead();
        if (last) this.runRead(last);
      },
      error: (error: HttpErrorResponse) => {
        this.applying.set(false);
        const message = apiProblemMessage(error, this.translate);
        this.failure.set(message);
        this.pushHistory(statement, false);
        this.toast.error(this.translate.instant('console.update.failed'), message);
      },
    });
  }

  dismissUpdate(): void {
    this.updateResult.set(null);
  }

  private updateMs(res: ConsoleUpdateResult): number {
    const value = res['executionMs'];
    return typeof value === 'number' ? value : 0;
  }

  // --------------------------------------------------------------- results ---

  onSort(next: { field: string; order: 'asc' | 'desc' } | null): void {
    this.sort.set(next);
    this.page.set(1);
  }

  onPage(page: number): void {
    this.page.set(page);
  }

  onPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
  }

  tripleCount(ntriples: string): number {
    return countTriples(ntriples);
  }

  exportCsv(): void {
    const res = this.result();
    if (!res || res.form !== 'select') return;
    const vars = res.vars ?? [];
    const body = this.tableRows().map((row) => {
      const cells: Record<string, unknown> = {};
      for (const name of vars) cells[name] = row[name] ?? '';
      return cells;
    });
    downloadCsv('sparql-results', vars, body);
  }

  exportJson(): void {
    const res = this.result();
    if (!res) return;
    downloadJson('sparql-result', res);
  }

  protected cellText(value: ResultValue | undefined): string {
    if (!value) return '';
    if (value.type === 'uri') return this.compact(value.value);
    const language = value['xml:lang'];
    return language ? `${value.value}@${language}` : value.value;
  }

  /** `<…/medical-care-ontology#Diabetes>` reads as `ont:Diabetes`. */
  private compact(iri: string): string {
    for (const [name, ns] of NAMESPACES) {
      if (iri.startsWith(ns)) return `${name}:${iri.slice(ns.length)}`;
    }
    return iri;
  }

  // ------------------------------------------------------ history and saves ---

  protected chip(query: string): string {
    return chipLabel(query);
  }

  protected since(at: string): string {
    return relativeTime(at, this.lang());
  }

  protected fullTitle(entry: ConsoleEntry): string {
    return `${chipLabel(entry.query)} · ${formatDateTime(entry.at, this.lang())}`;
  }

  useQuery(query: string): void {
    if (this.dirty()) {
      this.pendingTemplate.set(query);
      this.templateOpen.set(true);
      return;
    }
    this.applyText(query);
  }

  private pushHistory(query: string, ok: boolean): void {
    const entry: ConsoleEntry = { query, at: new Date().toISOString(), ok };
    this.history.update((list) => [entry, ...list.filter((item) => item.query !== query)].slice(0, HISTORY_MAX));
    writeList(HISTORY_KEY, this.history());
  }

  dropHistory(query: string): void {
    this.history.update((list) => list.filter((item) => item.query !== query));
    writeList(HISTORY_KEY, this.history());
  }

  clearHistory(): void {
    this.history.set([]);
    writeList(HISTORY_KEY, []);
  }

  saveCurrent(): void {
    const query = this.editorText().trim();
    if (!query) {
      this.toast.info(this.translate.instant('console.saved.empty'));
      return;
    }
    if (this.saved().some((item) => item.query === query)) {
      this.toast.info(this.translate.instant('console.saved.exists'));
      return;
    }
    const item: SavedQuery = { name: chipLabel(query), query, at: new Date().toISOString() };
    this.saved.update((list) => [item, ...list.filter((entry) => entry.query !== query)].slice(0, SAVED_MAX));
    writeList(SAVED_KEY, this.saved());
    this.toast.success(this.translate.instant('console.saved.stored'));
  }

  dropSaved(query: string): void {
    this.saved.update((list) => list.filter((item) => item.query !== query));
    writeList(SAVED_KEY, this.saved());
  }

  clearSaved(): void {
    this.saved.set([]);
    writeList(SAVED_KEY, []);
  }

  readonly historySubtitle = computed(() =>
    this.translate.instant('console.history.count', { count: this.history().length }),
  );

  readonly savedSubtitle = computed(() =>
    this.translate.instant('console.saved.count', { count: this.saved().length }),
  );

  private lang(): 'fr' | 'en' {
    return this.translate.currentLang === 'fr' ? 'fr' : 'en';
  }

}

function apiProblemMessage(error: HttpErrorResponse, translate: TranslateService): string {
  return problemOf(error)?.message ?? translate.instant('common.operationFailed');
}
