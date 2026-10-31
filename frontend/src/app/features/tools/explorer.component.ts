import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import cytoscape from 'cytoscape';
import { MetaService } from '../../core/api/entity.service';
import { OntologyService } from '../../core/api/ontology.service';
import { ENTITY_KEYS } from '../../core/api/models';
import type {
  ClassIndividualsPage,
  ClassNode,
  EntityKey,
  EntityMeta,
  GraphNode,
  GraphPayload,
  IndividualClassRow,
  IndividualDetail,
  OntologyStats,
  PropertyRow,
} from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/toast/toast.service';
import { compact } from '../../core/util/format';
import { humanize, labelOf } from '../../core/util/labels';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardActionsDirective, UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiChipComponent } from '../../shared/ui/chip/ui-chip.component';
import { UiCodeBlockComponent } from '../../shared/ui/code-block/ui-code-block.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiPageActionsDirective } from '../../shared/ui/page-header/ui-page-actions.directive';
import { UiPageHeaderComponent } from '../../shared/ui/page-header/ui-page-header.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiTabsComponent, type UiTab } from '../../shared/ui/tabs/ui-tabs.component';
import { UiTreeComponent } from '../../shared/ui/tree/ui-tree.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';

/** The four graph layouts the explorer can switch between, `cose` being the fcose-style force layout. */
type LayoutName = 'cose' | 'circle' | 'grid' | 'breadthfirst';

/** The details panel sections. */
type DetailsTab = 'classes' | 'object' | 'data' | 'individuals';

/** How a class restriction is worded, taken from the registry mirror the API serves. */
type RestrictionKind = 'some' | 'min' | 'max' | 'key';

interface NamedClass {
  readonly id: string;
  readonly label: string;
}

interface Restriction {
  readonly predicate: string;
  readonly kind: RestrictionKind;
  readonly target: string;
}

interface LegendEntry {
  readonly group: string;
  readonly label: string;
  readonly token: string;
  readonly count: number;
}

interface Chip {
  readonly label: string;
  readonly count: number;
}

interface TripleView {
  readonly predicate: string;
  readonly name: string;
  readonly value: string;
  readonly display: string;
  readonly isUri: boolean;
  readonly graphId: string | null;
  readonly recordLink: string | null;
}

/** Node colour per entity family, every entry a design token so light and dark both resolve. */
const FAMILY_TOKENS: Record<string, string> = {
  patients: '--primary-600',
  doctors: '--teal-500',
  diseases: '--danger-500',
  symptoms: '--warning-500',
  treatments: '--success-500',
  medications: '--info-500',
  tests: '--violet-500',
  appointments: '--primary-400',
  hospitals: '--violet-700',
  departments: '--teal-700',
  other: '--text-muted',
};

const CLASS_NODE_TOKEN = '--text';

const ID_PREFIX_TO_ENTITY: ReadonlyMap<string, EntityKey> = new Map<string, EntityKey>([
  ['Patient', 'patients'],
  ['Doctor', 'doctors'],
  ['Appointment', 'appointments'],
  ['Test', 'tests'],
  ['Disease', 'diseases'],
  ['Symptom', 'symptoms'],
  ['Treatment', 'treatments'],
  ['Medication', 'medications'],
  ['Hospital', 'hospitals'],
  ['Department', 'departments'],
]);

/**
 * The `owl:AllDisjointClasses` groups of the ontology, verbatim from
 * `backend/ontology/MedicCare_final_en.ttl` (lines 280-289), which is the same
 * text the store materialises through `backend/src/ontology/hierarchy.ts`.
 */
const DISJOINT_GROUPS: readonly (readonly string[])[] = [
  ['Patient', 'Doctor', 'Disease', 'Symptom', 'Treatment', 'Medication', 'MedicalTest', 'Hospital', 'MedicalAppointment', 'MedicalDepartment'],
  ['AdultPatient', 'ChildPatient', 'ElderlyPatient'],
  ['GeneralPractitioner', 'EmergencyPhysician', 'Cardiologist', 'Dermatologist', 'Neurologist'],
  ['Fever', 'Headache', 'Cough', 'Fatigue', 'ChestPain', 'SkinRash'],
  ['MedicationTreatment', 'SurgicalTreatment', 'Physiotherapy'],
  ['Antibiotic', 'Analgesic', 'Antiviral', 'Antihypertensive', 'Antidiabetic'],
  ['BloodTest', 'UrineTest', 'XRay', 'MRI', 'CTScan'],
  ['PublicHospital', 'PrivateHospital', 'UniversityHospital'],
  ['Consultation', 'FollowUpAppointment', 'EmergencyAppointment'],
  ['CardiologyDepartment', 'DermatologyDepartment', 'NeurologyDepartment', 'EmergencyDepartment', 'GeneralMedicineDepartment'],
];

/**
 * The `owl:equivalentClass` axioms the ontology declares, verbatim from
 * `backend/ontology/MedicCare_final_en.ttl` (lines 313-317). The three age
 * ranges are the ones `ageClassFor()` in `backend/src/ontology/hierarchy.ts`
 * applies when it materialises the types of a patient.
 */
const EQUIVALENT_CLASSES: readonly { id: string; expression: string }[] = [
  { id: 'ChildPatient', expression: 'Patient ⊓ ∃hasAge(xsd:integer with maxExclusive 18)' },
  { id: 'AdultPatient', expression: 'Patient ⊓ ∃hasAge(xsd:integer with minInclusive 18, maxExclusive 65)' },
  { id: 'ElderlyPatient', expression: 'Patient ⊓ ∃hasAge(xsd:integer with minInclusive 65)' },
  { id: 'ChronicPatient', expression: 'Patient ⊓ ∃hasDisease.ChronicDisease' },
  { id: 'EmergencyPatient', expression: 'Patient ⊓ ∃hasAppointment.EmergencyAppointment' },
];

const XSD_PREFIX: Record<string, string> = {
  string: 'xsd:string',
  integer: 'xsd:integer',
  date: 'xsd:date',
  dateTime: 'xsd:dateTime',
  decimal: 'xsd:decimal',
  boolean: 'xsd:boolean',
};

const INDIVIDUALS_PAGE_SIZE = 12;

/**
 * Ontology explorer: the class hierarchy on the left, the Cytoscape knowledge
 * graph in the centre and the asserted details on the right. ADMIN sees the raw
 * SPARQL entry point in the console; the doctor role browses the very same
 * screens, and the API keeps every write out of reach.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'page-explorer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslateModule,
    UiButtonComponent,
    UiCardActionsDirective,
    UiCardComponent,
    UiChipComponent,
    UiCodeBlockComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
    UiIconComponent,
    UiPageActionsDirective,
    UiPageHeaderComponent,
    UiSkeletonComponent,
    UiTabsComponent,
    UiTreeComponent,
  ],
  template: `
    <div class="page explorer">
      <ui-page-header [title]="'explorer.page.title' | translate" [subtitle]="subtitle()" icon="waypoints">
        <ng-template uiPageActions>
          <ui-button variant="outline" size="sm" icon="refresh" [loading]="busy()" (click)="refreshAll()">
            {{ 'common.refresh' | translate }}
          </ui-button>
        </ng-template>
        <div class="census" uiPageMeta>
          @for (item of census(); track item.label) {
            <ui-chip [label]="item.label" [count]="item.count" icon="database" />
          }
          @if (!isAdmin()) {
            <ui-chip icon="eye" [label]="('explorer.readonly' | translate)" />
          }
        </div>
      </ui-page-header>

      <div class="columns">
        <!-- LEFT: the class hierarchy -->
        <ui-card
          class="column column--tree"
          [title]="'explorer.tree.title' | translate"
          [subtitle]="'explorer.tree.hint' | translate"
          icon="git-branch"
          [pad]="'md'"
        >
          <div class="tree-tools">
            <ui-button variant="ghost" size="sm" icon="chevron-down" (click)="expandTree()">
              {{ 'explorer.tree.expandAll' | translate }}
            </ui-button>
            <ui-button variant="ghost" size="sm" icon="chevron-up" (click)="collapseTree()">
              {{ 'explorer.tree.collapseAll' | translate }}
            </ui-button>
          </div>

          @if (treeError()) {
            <ui-error-state
              [title]="'ui.error.title' | translate"
              [message]="'explorer.error.tree' | translate"
              [hint]="'common.retry' | translate"
              (retry)="loadHierarchy()"
            />
          } @else if (treeLoading()) {
            <div class="stack" aria-busy="true" [attr.aria-label]="'common.loading' | translate">
              @for (row of treeSlots; track row) {
                <ui-skeleton height="26px" [radius]="'var(--radius-input)'"></ui-skeleton>
              }
            </div>
          } @else {
            <ui-tree
              #tree
              [nodes]="classes()"
              [selectedId]="selectedClass()"
              [search]="true"
              (nodeSelect)="selectClass($event)"
            />
          }
        </ui-card>

        <!-- CENTRE: the graph -->
        <ui-card
          class="column column--graph"
          [title]="'explorer.graph.title' | translate"
          [subtitle]="graphSubtitle()"
          icon="waypoints"
          [pad]="'none'"
        >
          <div class="toolbar" [attr.aria-label]="'explorer.graph.controls' | translate">
            <div class="toolbar-group">
              <ui-button variant="secondary" size="sm" icon="plus" (click)="zoomIn()">
                <span class="sr-only">{{ 'explorer.graph.zoomIn' | translate }}</span>
              </ui-button>
              <ui-button variant="secondary" size="sm" icon="ellipsis" (click)="zoomOut()">
                <span class="sr-only">{{ 'explorer.graph.zoomOut' | translate }}</span>
              </ui-button>
              <ui-button variant="secondary" size="sm" icon="globe" (click)="fitView()">
                <span class="sr-only">{{ 'explorer.graph.fit' | translate }}</span>
              </ui-button>
              <ui-button variant="outline" size="sm" icon="refresh" [loading]="graphLoading()" (click)="loadGraph()">
                {{ 'common.refresh' | translate }}
              </ui-button>
            </div>

            <div class="toolbar-group">
              <span class="ui-label">{{ 'explorer.graph.layout' | translate }}</span>
              <select class="ui-control ui-control--inline" [value]="layoutName()" (change)="setLayout($event)">
                @for (option of layoutOptions(); track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
            </div>

            <div class="toolbar-group">
              <label class="ui-label" for="explorer-depth">{{ 'explorer.graph.depth' | translate }}</label>
              <select id="explorer-depth" class="ui-control ui-control--inline" [value]="depth()" (change)="setDepth($event)">
                @for (option of depthOptions(); track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
            </div>

            <div class="toolbar-group toolbar-group--range">
              <label class="ui-label" for="explorer-limit">
                {{ 'explorer.graph.limit' | translate }} — {{ limit() }}
              </label>
              <input
                id="explorer-limit"
                class="range"
                type="range"
                min="40"
                max="500"
                step="20"
                [value]="limit()"
                (input)="setLimit($event)"
              />
            </div>

            <div class="toolbar-group">
              <label class="ui-label" for="explorer-class-filter">{{ 'explorer.filter.class' | translate }}</label>
              <select
                id="explorer-class-filter"
                class="ui-control ui-control--inline"
                [value]="selectedClass() ?? ''"
                (change)="setClassFilter($event)"
              >
                <option value="">{{ 'explorer.filter.allClasses' | translate }}</option>
                @for (option of classOptions(); track option.id) {
                  <option [value]="option.id">{{ option.indent }}{{ option.label }}</option>
                }
              </select>
              <label class="check">
                <input type="checkbox" [checked]="filterByClass()" (change)="toggleFilter($event)" />
                {{ 'explorer.filter.only' | translate }}
              </label>
            </div>
          </div>

          <div class="stage">
            <div
              #viewport
              class="canvas"
              role="application"
              [attr.aria-label]="'explorer.graph.aria' | translate"
            ></div>

            @if (graphLoading()) {
              <div class="stage-overlay" aria-busy="true" [attr.aria-label]="'explorer.graph.loading' | translate">
                <ui-skeleton height="100%" [radius]="'var(--radius-card)'"></ui-skeleton>
              </div>
            }
            @if (graphError()) {
              <div class="stage-overlay stage-overlay--solid">
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="'explorer.error.graph' | translate"
                  [hint]="'common.retry' | translate"
                  (retry)="loadGraph()"
                />
              </div>
            }
            @if (!graphLoading() && !graphError() && drawnCount() === 0) {
              <div class="stage-overlay stage-overlay--solid">
                <ui-empty-state
                  icon="waypoints"
                  [title]="'explorer.graph.empty' | translate"
                  [hint]="graphEmptyHint()"
                />
              </div>
            }
          </div>

          <div class="statusline">
            <span class="muted">{{ countsLine() }}</span>
            @if (focusNode(); as node) {
              <span class="focus-chip">
                <ui-chip icon="target" [label]="node.label" />
                <ui-button variant="ghost" size="sm" icon="x" (click)="clearFocus()">
                  {{ 'explorer.graph.clearFocus' | translate }}
                </ui-button>
              </span>
            }
          </div>

          <div class="legend" [attr.aria-label]="'explorer.legend.title' | translate">
            @if (classNodeVisible()) {
              <span class="legend-item">
                <span class="swatch swatch--class" [style.background]="tokenValue('--text')"></span>
                <span>{{ 'explorer.legend.class' | translate }}</span>
              </span>
            }
            @for (entry of legend(); track entry.group) {
              <span class="legend-item" [attr.title]="legendTitle(entry)">
                <span class="swatch" [style.background]="entry.token"></span>
                <span class="legend-label truncate">{{ entry.label }}</span>
                <span class="legend-count">{{ entry.count }}</span>
              </span>
            }
          </div>

          <div class="query">
            <button type="button" class="query-toggle" [attr.aria-expanded]="sparqlOpen()" (click)="toggleSparql()">
              <ui-icon [name]="sparqlOpen() ? 'chevron-down' : 'chevron-right'" [size]="16" />
              {{ (sparqlOpen() ? 'explorer.sparql.hide' : 'explorer.sparql.title') | translate }}
            </button>
            @if (sparqlOpen()) {
              <ui-code-block
                language="sparql"
                [code]="sparqlText()"
                [label]="('explorer.sparql.label' | translate)"
                [maxHeight]="'260px'"
                [wrap]="true"
              />
              <p class="query-note muted">{{ 'explorer.sparql.note' | translate: { count: limit() } }}</p>
              @if (isAdmin()) {
                <ui-button variant="ghost" size="sm" icon="terminal" (click)="openConsole()">
                  {{ 'explorer.sparql.console' | translate }}
                </ui-button>
              }
            }
          </div>
        </ui-card>

        <!-- RIGHT: the details panel -->
        <ui-card
          class="column column--details"
          [title]="'explorer.details.title' | translate"
          [subtitle]="detailsSubtitle()"
          icon="list"
          [pad]="'md'"
        >
          <ui-tabs [tabs]="tabs()" [active]="tab()" (activeChange)="setTab($event)">
            @if (tab() === 'classes') {
              @if (classCard(); as card) {
                <dl class="facts">
                  <div class="fact">
                    <dt>{{ 'common.label' | translate }}</dt>
                    <dd>{{ card.label }}</dd>
                  </div>
                  <div class="fact">
                    <dt>{{ 'explorer.class.iri' | translate }}</dt>
                    <dd><code class="mono">{{ card.iri ?? ('common.notSet' | translate) }}</code></dd>
                  </div>
                  @if (card.entity) {
                    <div class="fact">
                      <dt>{{ 'explorer.class.entity' | translate }}</dt>
                      <dd>{{ card.entity }}</dd>
                    </div>
                  }
                </dl>

                <section class="block">
                  <h4 class="block-title">{{ 'explorer.class.parent' | translate }}</h4>
                  @if (card.chain.length === 0) {
                    <p class="muted">{{ 'explorer.class.root' | translate }}</p>
                  } @else {
                    <div class="chips">
                      @for (entry of card.chain; track entry.id) {
                        <button type="button" class="chip" (click)="selectClass(entry.id)">{{ entry.label }}</button>
                      }
                    </div>
                  }
                </section>

                <section class="block">
                  <h4 class="block-title">{{ 'explorer.class.subclasses' | translate }}</h4>
                  @if (card.subclasses.length === 0) {
                    <p class="muted">{{ 'explorer.class.noneSub' | translate }}</p>
                  } @else {
                    <div class="chips">
                      @for (entry of card.subclasses; track entry.id) {
                        <button type="button" class="chip" (click)="selectClass(entry.id)">{{ entry.label }}</button>
                      }
                    </div>
                  }
                </section>

                <section class="block">
                  <h4 class="block-title">{{ 'explorer.class.disjoint' | translate }}</h4>
                  @if (card.disjoint.length === 0) {
                    <p class="muted">{{ 'explorer.class.noneDisjoint' | translate }}</p>
                  } @else {
                    <div class="chips">
                      @for (entry of card.disjoint; track entry.id) {
                        <button type="button" class="chip chip--muted" (click)="selectClass(entry.id)">
                          {{ entry.label }}
                        </button>
                      }
                    </div>
                  }
                </section>

                <section class="block">
                  <h4 class="block-title">{{ 'explorer.class.restrictions' | translate }}</h4>
                  @if (card.restrictions.length === 0) {
                    <p class="muted">{{ 'explorer.class.noneRestriction' | translate }}</p>
                  } @else {
                    <ul class="rows">
                      @for (restriction of card.restrictions; track restriction.predicate + restriction.kind) {
                        <li class="row">
                          <span class="kind">{{ restrictionKeyword(restriction.kind) | translate }}</span>
                          <span class="mono truncate">{{ restriction.predicate }}</span>
                          <span class="muted truncate">{{ restriction.target }}</span>
                        </li>
                      }
                    </ul>
                  }
                </section>

                <section class="block">
                  <h4 class="block-title">{{ 'explorer.class.equivalent' | translate }}</h4>
                  @if (card.equivalent.length === 0) {
                    <p class="muted">{{ 'explorer.class.noneEquivalent' | translate }}</p>
                  } @else {
                    <ul class="rows">
                      @for (expression of card.equivalent; track expression) {
                        <li class="row row--wide"><code class="mono">{{ expression }}</code></li>
                      }
                    </ul>
                  }
                </section>

                <section class="block">
                  <h4 class="block-title">{{ 'explorer.class.individuals' | translate: { total: individualsTotal() } }}</h4>
                  <ng-container [ngTemplateOutlet]="individualsBlock" />
                </section>
              } @else {
                <ui-empty-state
                  icon="git-branch"
                  [title]="'explorer.class.noneSelected' | translate"
                  [hint]="'explorer.class.pick' | translate"
                />
              }
            }

            @if (tab() === 'object' || tab() === 'data') {
              <div class="ui-field">
                <label class="ui-label" for="explorer-property-search">{{ 'explorer.property.search' | translate }}</label>
                <input
                  id="explorer-property-search"
                  class="ui-control"
                  type="search"
                  autocomplete="off"
                  [value]="propertyTerm()"
                  (input)="onPropertyTerm($event)"
                />
              </div>

              @if (propertiesError()) {
                <ui-error-state
                  [title]="'ui.error.title' | translate"
                  [message]="'explorer.error.properties' | translate"
                  [hint]="'common.retry' | translate"
                  (retry)="loadProperties()"
                />
              } @else if (propertiesLoading()) {
                <div class="stack" aria-busy="true" [attr.aria-label]="'common.loading' | translate">
                  @for (row of propertySlots; track row) {
                    <ui-skeleton height="34px" [radius]="'var(--radius-input)'"></ui-skeleton>
                  }
                </div>
              } @else {
                <p class="muted">{{ 'explorer.property.count' | translate: { count: propertyRows().length } }}</p>
                @if (propertyRows().length === 0) {
                  <ui-empty-state
                    icon="filter"
                    [title]="'ui.table.emptyFiltered' | translate"
                    [hint]="'explorer.property.empty' | translate"
                  />
                } @else {
                  <ul class="rows rows--list">
                    @for (row of propertyRows(); track row.name) {
                      <li class="row">
                        <button
                          type="button"
                          class="pick"
                          [class.pick--active]="row.name === selectedProperty()"
                          (click)="selectProperty(row.name)"
                        >
                          <span class="truncate mono">{{ row.name }}</span>
                          <span class="muted">{{ kindLabel(row.kind) }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                }
              }

              @if (propertyCard(); as property) {
                <section class="block block--spaced">
                  <h4 class="block-title truncate">{{ property.name }}</h4>
                  <dl class="facts facts--tight">
                    <div class="fact">
                      <dt>{{ 'explorer.property.kindLabel' | translate }}</dt>
                      <dd>{{ kindLabel(property.row.kind) }}</dd>
                    </div>
                    <div class="fact">
                      <dt>{{ 'explorer.property.domain' | translate }}</dt>
                      <dd>
                        @if (property.domain.length === 0) {
                          <span class="muted">{{ 'explorer.property.noDomain' | translate }}</span>
                        } @else {
                          <div class="chips">
                            @for (entry of property.domain; track entry.id) {
                              <button type="button" class="chip" (click)="selectClass(entry.id)">{{ entry.label }}</button>
                            }
                          </div>
                        }
                      </dd>
                    </div>
                    <div class="fact">
                      <dt>{{ 'explorer.property.range' | translate }}</dt>
                      <dd>
                        @if (property.range.length === 0) {
                          <span class="muted">{{ 'explorer.property.noRange' | translate }}</span>
                        } @else {
                          <div class="chips">
                            @for (entry of property.range; track entry.id) {
                              <button type="button" class="chip" (click)="selectClass(entry.id)">{{ entry.label }}</button>
                            }
                          </div>
                        }
                      </dd>
                    </div>
                    @if (property.inverse) {
                      <div class="fact">
                        <dt>{{ 'explorer.property.inverse' | translate }}</dt>
                        <dd><button type="button" class="chip" (click)="selectProperty(property.inverse)">{{ property.inverse }}</button></dd>
                      </div>
                    }
                  </dl>

                  <h5 class="block-subtitle">{{ 'explorer.property.characteristics' | translate }}</h5>
                  @if (property.characteristics.length === 0) {
                    <p class="muted">{{ 'explorer.property.noCharacteristic' | translate }}</p>
                  } @else {
                    <div class="chips">
                      @for (item of property.characteristics; track item) {
                        <ui-chip [label]="item" icon="zap" />
                      }
                    </div>
                  }

                  @if (property.chains.length > 0) {
                    <h5 class="block-subtitle">{{ 'explorer.property.chains' | translate }}</h5>
                    <ul class="rows">
                      @for (chain of property.chains; track $index) {
                        <li class="row row--wide"><code class="mono">{{ chain.join(' o ') }}</code></li>
                      }
                    </ul>
                  }

                  <h5 class="block-subtitle">{{ 'explorer.property.usedBy' | translate }}</h5>
                  @if (property.usedBy.length === 0) {
                    <p class="muted">{{ 'explorer.property.noUsedBy' | translate }}</p>
                  } @else {
                    <div class="chips">
                      @for (usage of property.usedBy; track usage.path) {
                        <button type="button" class="chip" (click)="selectClass(usage.classLocal)">
                          {{ usage.label }}
                        </button>
                      }
                    </div>
                    <p class="muted">{{ 'explorer.property.classes' | translate }}: {{ property.usedClasses }}</p>
                  }
                </section>
              }
            }

            @if (tab() === 'individuals') {
              @if (individualCard(); as person) {
                <dl class="facts facts--tight">
                  <div class="fact">
                    <dt>{{ 'common.name' | translate }}</dt>
                    <dd>{{ person.label }}</dd>
                  </div>
                  <div class="fact">
                    <dt>{{ 'explorer.class.iri' | translate }}</dt>
                    <dd><code class="mono">{{ person.row.iri }}</code></dd>
                  </div>
                </dl>

                @if (person.types.length > 0) {
                  <section class="block">
                    <h4 class="block-title">{{ 'explorer.individual.types' | translate }}</h4>
                    <div class="chips">
                      @for (entry of person.types; track entry.id) {
                        <button type="button" class="chip" (click)="selectClass(entry.id)">{{ entry.label }}</button>
                      }
                    </div>
                  </section>
                }

                @if (person.recordLink) {
                  <div class="block">
                    <ui-button variant="outline" size="sm" icon="external-link" [href]="person.recordLink">
                      {{ 'explorer.individual.record' | translate }}
                    </ui-button>
                  </div>
                }

                <section class="block">
                  <h4 class="block-title">{{ 'explorer.individual.outgoing' | translate }}</h4>
                  @if (person.outgoing.length === 0) {
                    <p class="muted">{{ 'explorer.individual.noOutgoing' | translate }}</p>
                  } @else {
                    <ul class="rows">
                      @for (triple of person.outgoing; track triple.predicate + triple.value) {
                        <li class="row row--triple">
                          <span class="mono truncate">{{ triple.predicate }}</span>
                          @if (triple.graphId !== null) {
                            <button type="button" class="chip" (click)="selectIndividual(triple.graphId)">
                              {{ triple.display }}
                            </button>
                          } @else {
                            <span class="truncate">{{ triple.display }}</span>
                          }
                          @if (triple.recordLink !== null) {
                            <a class="id-link" [href]="triple.recordLink">{{ 'explorer.individual.record' | translate }}</a>
                          }
                        </li>
                      }
                    </ul>
                  }
                </section>

                <section class="block">
                  <h4 class="block-title">{{ 'explorer.individual.incoming' | translate }}</h4>
                  @if (person.incoming.length === 0) {
                    <p class="muted">{{ 'explorer.individual.noIncoming' | translate }}</p>
                  } @else {
                    <ul class="rows">
                      @for (triple of person.incoming; track triple.predicate + triple.value) {
                        <li class="row row--triple">
                          <span class="mono truncate">{{ triple.predicate }}</span>
                          @if (triple.graphId !== null) {
                            <button type="button" class="chip" (click)="selectIndividual(triple.graphId)">
                              {{ triple.display }}
                            </button>
                          } @else {
                            <span class="truncate">{{ triple.display }}</span>
                          }
                          @if (triple.recordLink !== null) {
                            <a class="id-link" [href]="triple.recordLink">{{ 'explorer.individual.record' | translate }}</a>
                          }
                        </li>
                      }
                    </ul>
                  }
                </section>

                <div class="block">
                  <ui-button variant="ghost" size="sm" icon="arrow-left" (click)="backToClass()">
                    {{ 'explorer.individual.back' | translate }}
                  </ui-button>
                </div>
              } @else {
                <ui-empty-state
                  icon="user"
                  [title]="'explorer.individual.noneSelected' | translate"
                  [hint]="'explorer.individual.pick' | translate"
                />
                @if (selectedClass() !== null) {
                  <section class="block">
                    <h4 class="block-title">{{ 'explorer.class.individuals' | translate: { total: individualsTotal() } }}</h4>
                    <ng-container [ngTemplateOutlet]="individualsBlock" />
                  </section>
                }
              }
            }
          </ui-tabs>
        </ui-card>
      </div>
    </div>

    <ng-template #individualsBlock>
      @if (individualsError()) {
        <ui-error-state
          [title]="'ui.error.title' | translate"
          [message]="'explorer.error.individuals' | translate"
          [hint]="'common.retry' | translate"
          (retry)="loadIndividuals()"
        />
      } @else if (individualsLoading()) {
        <div class="stack" aria-busy="true" [attr.aria-label]="'common.loading' | translate">
          @for (row of individualSlots; track row) {
            <ui-skeleton height="32px" [radius]="'var(--radius-input)'"></ui-skeleton>
          }
        </div>
      } @else if (individualRows().length === 0) {
        <ui-empty-state
          icon="users"
          [title]="'explorer.class.noIndividuals' | translate"
          [hint]="'explorer.class.noIndividualsHint' | translate"
        />
      } @else {
        <ul class="rows rows--list">
          @for (row of individualRows(); track row.id) {
            <li class="row">
              <button type="button" class="pick" [class.pick--active]="row.id === focusId()" (click)="selectIndividual(row.id)">
                <span class="truncate">{{ row.label }}</span>
                <span class="muted mono">{{ row.id }}</span>
              </button>
            </li>
          }
        </ul>
        <div class="pager">
          <span class="muted">{{ 'explorer.class.pager' | translate: { page: individualPage(), total: individualPages() } }}</span>
          <ui-button variant="ghost" size="sm" icon="chevron-left" [disabled]="individualPage() <= 1" (click)="turnPage(-1)">
            {{ 'ui.pagination.previous' | translate }}
          </ui-button>
          <ui-button
            variant="ghost"
            size="sm"
            iconRight="chevron-right"
            [disabled]="individualPage() >= individualPages()"
            (click)="turnPage(1)"
          >
            {{ 'ui.pagination.next' | translate }}
          </ui-button>
        </div>
        @if (individualsCapped()) {
          <p class="muted">{{ 'explorer.class.capped' | translate: { shown: individualsShown(), total: individualsTotal() } }}</p>
        }
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .explorer {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .census {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .columns {
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: minmax(0, 1fr);
        align-items: start;
      }
      .column {
        min-width: 0;
      }
      @media (min-width: 1279px) {
        .columns {
          grid-template-columns: minmax(0, 300px) minmax(0, 1fr) minmax(0, 400px);
        }
        .column--tree,
        .column--details {
          max-block-size: calc(100vh - var(--topbar-height) - var(--sp-8));
          overflow-y: auto;
          scrollbar-width: thin;
        }
      }
      .tree-tools {
        display: flex;
        gap: var(--sp-2);
        margin-block-end: var(--sp-2);
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--sp-3);
        padding: var(--sp-3) var(--sp-4);
        border-bottom: 1px solid var(--border);
        background: var(--surface-alt);
      }
      .toolbar-group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
        min-width: 0;
      }
      .toolbar-group--range {
        flex: 1 1 180px;
        min-inline-size: 140px;
      }
      .ui-control--inline {
        inline-size: auto;
        min-inline-size: 8ch;
      }
      .range {
        flex: 1 1 120px;
        min-inline-size: 100px;
        accent-color: var(--primary);
        background: transparent;
        border-radius: var(--radius-pill);
      }
      .range:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        font-size: var(--fs-sm);
        color: var(--text-muted);
      }
      .check input {
        accent-color: var(--primary);
      }
      .stage {
        position: relative;
        inline-size: 100%;
        block-size: clamp(320px, 48vh, 620px);
        background: var(--bg-sunken);
        overflow: hidden;
      }
      .canvas {
        position: absolute;
        inset: 0;
      }
      .stage-overlay {
        position: absolute;
        inset: var(--sp-3);
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .stage-overlay--solid {
        background: var(--surface);
        pointer-events: auto;
      }
      .statusline {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
        padding: var(--sp-2) var(--sp-4);
        border-bottom: 1px solid var(--border);
        font-size: var(--fs-sm);
      }
      .focus-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2) var(--sp-4);
        padding: var(--sp-3) var(--sp-4);
        border-bottom: 1px solid var(--border);
        font-size: var(--fs-xs);
        color: var(--text-muted);
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        min-inline-size: 0;
        max-inline-size: 100%;
      }
      .swatch {
        inline-size: var(--sp-3);
        block-size: var(--sp-3);
        flex: none;
        border-radius: 50%;
        border: 1px solid var(--border-strong);
      }
      .swatch--class {
        border-radius: var(--radius-input);
        transform: rotate(45deg);
      }
      .legend-count {
        font-variant-numeric: tabular-nums;
        color: var(--text-subtle);
      }
      .query {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        padding: var(--sp-3) var(--sp-4) var(--sp-4);
      }
      .query-toggle {
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
        transition: color var(--duration) var(--ease), background var(--duration) var(--ease);
      }
      .query-toggle:hover {
        color: var(--primary-hover);
        background: var(--bg-hover);
      }
      .query-toggle:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .query-note {
        margin: 0;
        font-size: var(--fs-xs);
      }
      .facts {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        margin: 0 0 var(--sp-3);
      }
      .facts--tight .fact {
        gap: var(--sp-1);
      }
      .fact {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .fact dt {
        font-size: var(--fs-xs);
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-subtle);
      }
      .fact dd {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text);
        overflow-wrap: anywhere;
      }
      .block {
        margin-block: 0 var(--sp-4);
        min-width: 0;
      }
      .block--spaced {
        margin-block-start: var(--sp-4);
        padding-block-start: var(--sp-3);
        border-block-start: 1px solid var(--border);
      }
      .block-title {
        margin: 0 0 var(--sp-2);
        font-size: var(--fs-sm);
        font-weight: 650;
        color: var(--text);
      }
      .block-subtitle {
        margin: var(--sp-3) 0 var(--sp-2);
        font-size: var(--fs-xs);
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-subtle);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        max-inline-size: 100%;
        padding: 2px var(--sp-2);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-pill);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: var(--fs-xs);
        font-weight: 600;
        cursor: pointer;
        overflow-wrap: anywhere;
        transition: color var(--duration) var(--ease), border-color var(--duration) var(--ease), background var(--duration) var(--ease);
      }
      .chip:hover {
        border-color: var(--primary);
        color: var(--primary);
      }
      .chip:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .chip--muted {
        color: var(--text-muted);
        font-weight: 500;
      }
      .rows {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        margin: 0;
        padding: 0;
        list-style: none;
        min-width: 0;
      }
      .rows--list {
        max-block-size: 260px;
        overflow-y: auto;
        scrollbar-width: thin;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
        min-width: 0;
        font-size: var(--fs-sm);
      }
      .row--wide {
        display: block;
        overflow-wrap: anywhere;
      }
      .row--triple {
        padding-block: var(--sp-1);
        border-block-end: 1px solid var(--border);
      }
      .kind {
        display: inline-block;
        min-inline-size: 9ch;
        font-size: var(--fs-xs);
        font-weight: 650;
        color: var(--primary);
      }
      .pick {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
        inline-size: 100%;
        min-inline-size: 0;
        padding: var(--sp-2) var(--sp-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: var(--fs-sm);
        text-align: start;
        cursor: pointer;
        transition: border-color var(--duration) var(--ease), background var(--duration) var(--ease);
      }
      .pick:hover {
        border-color: var(--primary);
        background: var(--bg-hover);
      }
      .pick:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .pick--active {
        border-color: var(--primary);
        background: var(--primary-soft);
        color: var(--primary);
      }
      .pager {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--sp-2);
        margin-block-start: var(--sp-2);
      }
      .mono {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
      }
      .muted {
        color: var(--text-muted);
        font-size: var(--fs-sm);
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .id-link {
        color: var(--primary);
        font-size: var(--fs-xs);
        font-weight: 600;
        border-radius: var(--radius-input);
        text-decoration: none;
      }
      .id-link:hover {
        color: var(--primary-hover);
        text-decoration: underline;
      }
      .id-link:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
})
export class ExplorerComponent {
  private readonly ontology = inject(OntologyService);
  private readonly meta = inject(MetaService);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  private readonly tree = viewChild<UiTreeComponent>('tree');

  private graph: cytoscape.Core | null = null;
  private activeLayout: cytoscape.Layouts | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  readonly classes = signal<ClassNode[]>([]);
  readonly stats = signal<OntologyStats | null>(null);
  readonly properties = signal<PropertyRow[]>([]);
  readonly payload = signal<GraphPayload | null>(null);
  readonly individualsPage = signal<ClassIndividualsPage | null>(null);
  readonly detail = signal<IndividualDetail | null>(null);

  readonly treeLoading = signal(true);
  readonly treeError = signal(false);
  readonly propertiesLoading = signal(true);
  readonly propertiesError = signal(false);
  readonly graphLoading = signal(true);
  readonly graphError = signal(false);
  readonly individualsLoading = signal(false);
  readonly individualsError = signal(false);
  readonly detailLoading = signal(false);
  readonly detailError = signal(false);

  readonly tab = signal<DetailsTab>('classes');
  readonly selectedClass = signal<string | null>(null);
  readonly focusId = signal<string | null>(null);
  readonly selectedProperty = signal<string | null>(null);
  readonly propertyTerm = signal('');
  readonly layoutName = signal<LayoutName>('cose');
  readonly depth = signal(2);
  readonly limit = signal(160);
  readonly filterByClass = signal(false);
  readonly individualPage = signal(1);
  readonly sparqlOpen = signal(false);

  /** The ontology namespace, recovered from the IRIs the store actually serves. */
  private readonly namespace = signal<string | null>(null);

  protected readonly treeSlots = ['1', '2', '3', '4', '5', '6'];
  protected readonly propertySlots = ['1', '2', '3', '4', '5'];
  protected readonly individualSlots = ['1', '2', '3', '4'];

  readonly isAdmin = computed(() => this.auth.hasRole('ADMIN'));

  readonly readableEntities = computed<ReadonlySet<EntityKey>>(() => {
    const permissions = this.auth.permissions();
    return new Set(ENTITY_KEYS.filter((key) => (permissions[key] ?? []).includes('read')));
  });

  readonly entityMetas = computed<EntityMeta[]>(() => this.meta.entities());

  readonly busy = computed(() => this.treeLoading() || this.graphLoading());

  readonly subtitle = computed<string | null>(() => {
    const census = this.censusValues();
    if (census === null) return this.translate.instant('explorer.page.lede');
    return this.translate.instant('explorer.page.subtitle', {
      classes: census.classes,
      objectProperties: census.objectProperties,
      datatypeProperties: census.datatypeProperties,
      individuals: census.namedIndividuals,
      triples: compact(census.triples),
    });
  });

  private readonly censusValues = computed(() => {
    const stats = this.stats();
    return stats === null
      ? null
      : {
          triples: stats.triples,
          classes: stats.classes,
          objectProperties: stats.objectProperties,
          datatypeProperties: stats.datatypeProperties,
          namedIndividuals: stats.namedIndividuals,
        };
  });

  protected readonly census = computed<Chip[]>(() => {
    const census = this.censusValues();
    if (census === null) return [];
    return [
      { label: this.translate.instant('explorer.census.triples'), count: census.triples },
      { label: this.translate.instant('explorer.census.classes'), count: census.classes },
      { label: this.translate.instant('explorer.census.objectProperties'), count: census.objectProperties },
      { label: this.translate.instant('explorer.census.datatypeProperties'), count: census.datatypeProperties },
      { label: this.translate.instant('explorer.census.namedIndividuals'), count: census.namedIndividuals },
    ];
  });

  /** Every class by id, so the parent chain and the subclasses stay local lookups. */
  private readonly classIndex = computed<Map<string, ClassNode>>(() => {
    const index = new Map<string, ClassNode>();
    const walk = (list: ClassNode[]): void => {
      for (const node of list) {
        index.set(node.id, node);
        walk(node.children);
      }
    };
    walk(this.classes());
    return index;
  });

  /** Individual id -> the entity family it belongs to, from the served graph groups and type sets. */
  private readonly entityOfId = computed<Map<string, EntityKey>>(() => {
    const map = new Map<string, EntityKey>();
    for (const node of this.payload()?.nodes ?? []) {
      if (node.group !== 'other' && ENTITY_KEYS.includes(node.group as EntityKey)) map.set(node.id, node.group as EntityKey);
    }
    for (const row of this.individualsPage()?.items ?? []) {
      const key = this.entityOfTypes(row.types);
      if (key !== null) map.set(row.id, key);
    }
    return map;
  });

  /** Individual id -> label, used wherever a triple only carries an id. */
  private readonly labelOfId = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const node of this.payload()?.nodes ?? []) map.set(node.id, node.label);
    for (const row of this.individualsPage()?.items ?? []) map.set(row.id, row.label);
    return map;
  });

  private entityOfTypes(types: readonly string[]): EntityKey | null {
    for (const entity of this.entityMetas()) {
      if (types.includes(entity.classLocal)) return entity.key;
    }
    for (const type of types) {
      const root = type.replace(/[^A-Za-z]$/, '');
      const key = ID_PREFIX_TO_ENTITY.get(root);
      if (key !== undefined) return key;
    }
    return null;
  }

  protected readonly classOptions = computed<{ id: string; label: string; indent: string }[]>(() => {
    const rows: { id: string; label: string; indent: string }[] = [];
    const walk = (list: ClassNode[], level: number): void => {
      for (const node of [...list].sort((a, b) => a.label.localeCompare(b.label))) {
        rows.push({ id: node.id, label: node.label, indent: '\u00A0\u00A0'.repeat(level) });
        walk(node.children, level + 1);
      }
    };
    walk(this.classes(), 0);
    return rows;
  });

  protected readonly tabs = computed<UiTab[]>(() => [
    { id: 'classes', label: this.translate.instant('explorer.tab.classes'), icon: 'git-branch', badge: this.individualsTotal() },
    { id: 'object', label: this.translate.instant('explorer.tab.object'), icon: 'route', badge: this.objectCount() },
    { id: 'data', label: this.translate.instant('explorer.tab.data'), icon: 'braces', badge: this.dataCount() },
    { id: 'individuals', label: this.translate.instant('explorer.tab.individuals'), icon: 'user', badge: this.tripleCount() },
  ]);

  private readonly objectCount = computed(() => this.properties().filter((row) => row.kind === 'object').length);
  private readonly dataCount = computed(() => this.properties().filter((row) => row.kind !== 'object').length);
  private readonly tripleCount = computed(() => {
    const detail = this.detail();
    return detail === null ? 0 : detail.outgoing.length + detail.incoming.length;
  });

  readonly detailsSubtitle = computed(() => {
    const card = this.classCard();
    if (this.tab() === 'individuals' && this.individualCard() !== null) return this.individualCard()?.label ?? null;
    if (this.tab() === 'object' || this.tab() === 'data') {
      const property = this.propertyCard();
      return property === null ? this.translate.instant('explorer.property.subtitle') : property.name;
    }
    return card === null ? this.translate.instant('explorer.details.pickClass') : card.label;
  });

  /** Everything the class section shows, built from the served hierarchy and registry. */
  readonly classCard = computed(() => {
    const id = this.selectedClass();
    if (id === null) return null;
    const node = this.classIndex().get(id);
    if (node === undefined) return null;
    const named = (local: string): NamedClass => ({
      id: local,
      label: this.classIndex().get(local)?.label ?? local,
    });
    const chain: NamedClass[] = [];
    const seen = new Set<string>([id]);
    let cursor = node.parent;
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      chain.push(named(cursor));
      cursor = this.classIndex().get(cursor)?.parent;
    }
    const owner = this.entityMetas().find((entity) => entity.classLocal === id) ?? null;
    const restrictions: Restriction[] = [];
    if (owner !== null) {
      for (const relation of owner.relations) {
        if (relation.readOnly) continue;
        const target = this.classLabelOf(relation.target);
        if (relation.required) restrictions.push({ predicate: relation.predicate, kind: 'some', target });
        if (relation.functional || relation.cardinality === 'one') {
          restrictions.push({ predicate: relation.predicate, kind: 'max', target });
        }
      }
      for (const field of owner.data) {
        const datatype = XSD_PREFIX[field.datatype] ?? 'xsd:string';
        if (field.required) restrictions.push({ predicate: field.predicate, kind: 'some', target: datatype });
        if (field.unique) restrictions.push({ predicate: field.predicate, kind: 'key', target: datatype });
        if (field.values !== null && field.values.length > 0) {
          restrictions.push({ predicate: field.predicate, kind: 'min', target: `${datatype} oneOf ${field.values.join(', ')}` });
        }
      }
    }
    const group = DISJOINT_GROUPS.find((list) => list.includes(id));
    const equivalent = EQUIVALENT_CLASSES.filter((entry) => entry.id === id).map((entry) => entry.expression);
    return {
      id,
      label: node.label,
      iri: this.namespace() === null ? null : `${this.namespace()}${id}`,
      entity: owner === null ? null : `${owner.label} (${owner.plural})`,
      chain,
      subclasses: node.children.map((child) => ({ id: child.id, label: child.label })),
      disjoint: group === undefined ? [] : group.filter((local) => local !== id).map(named),
      restrictions,
      equivalent,
    };
  });

  private classLabelOf(key: EntityKey): string {
    const entity = this.entityMetas().find((candidate) => candidate.key === key);
    if (entity === undefined) return key;
    return `${entity.classLocal} — ${entity.classLabel}`;
  }

  protected restrictionKeyword(kind: RestrictionKind): string {
    return `explorer.restriction.${kind}`;
  }

  protected readonly individualsTotal = computed(() => this.individualsPage()?.total ?? 0);
  protected readonly individualsShown = computed(() => this.individualsPage()?.items.length ?? 0);
  protected readonly individualsCapped = computed(
    () => this.individualsTotal() > this.individualsShown() && this.individualsShown() >= 500,
  );

  protected readonly individualPages = computed(() =>
    Math.max(1, Math.ceil(Math.min(this.individualsTotal(), 500) / INDIVIDUALS_PAGE_SIZE)),
  );

  /** The endpoint caps at 500 rows, so a page is the tail of the requested window. */
  protected readonly individualRows = computed<IndividualClassRow[]>(() => {
    const items = this.individualsPage()?.items ?? [];
    const start = (this.individualPage() - 1) * INDIVIDUALS_PAGE_SIZE;
    return items.slice(start, start + INDIVIDUALS_PAGE_SIZE);
  });

  protected readonly propertyRows = computed<PropertyRow[]>(() => {
    const wanted = this.tab() === 'object' ? 'object' : 'other';
    const term = this.propertyTerm().toLowerCase();
    return this.properties().filter((row) => {
      const kindMatch = wanted === 'object' ? row.kind === 'object' : row.kind !== 'object';
      return kindMatch && (term.length === 0 || row.name.toLowerCase().includes(term));
    });
  });

  private readonly selectedRow = computed<PropertyRow | null>(() => {
    const name = this.selectedProperty();
    if (name === null) return null;
    return this.properties().find((row) => row.name === name) ?? null;
  });

  /** The property section: domain, range, inverse, characteristics, chains and the classes using it. */
  readonly propertyCard = computed(() => {
    const row = this.selectedRow();
    if (row === null) return null;
    const named = (local: string): NamedClass => ({ id: local, label: this.classIndex().get(local)?.label ?? local });
    const usedBy = row.usedBy.map((path) => {
      const key = path.split('.')[0] ?? '';
      const entity = this.entityMetas().find((candidate) => candidate.key === key);
      return {
        path,
        classLocal: entity?.classLocal ?? key,
        label: entity === undefined ? humanize(key) : `${entity.classLocal} · ${path}`,
      };
    });
    const classes = [...new Set(usedBy.map((usage) => usage.classLocal))];
    return {
      name: row.name,
      row,
      domain: row.domain.map(named),
      range: row.range.map(named),
      inverse: row.inverse ?? null,
      characteristics: [...row.characteristics, ...(row.chains.length > 0 ? [this.translate.instant('explorer.property.chainFlag')] : [])],
      chains: row.chains,
      usedBy,
      usedClasses: classes.map((local) => this.classIndex().get(local)?.label ?? local).join(', '),
    };
  });

  protected kindLabel(kind: PropertyRow['kind']): string {
    return labelOf(this.translate, `explorer.property.kind.${kind}`, kind);
  }

  /** The focused individual with its asserted triples in both directions. */
  readonly individualCard = computed(() => {
    const detail = this.detail();
    const id = this.focusId();
    if (detail === null || id === null) return null;
    const label = this.labelOfId().get(id) ?? id;
    const readable = this.readableEntities();
    const triple = (predicate: string, value: string, isUri: boolean): TripleView => {
      const known = isUri ? this.labelOfId().get(value) ?? value : value;
      const key = isUri ? this.entityOfId().get(value) ?? null : null;
      return {
        predicate,
        name: humanize(predicate.replace(/^:/, '')),
        value,
        display: known,
        isUri,
        graphId: isUri ? value : null,
        recordLink: isUri && key !== null && readable.has(key) ? `/records/${key}/${value}` : null,
      };
    };
    const owner = this.entityOfId().get(id) ?? null;
    return {
      id,
      label,
      row: detail,
      recordLink: owner !== null && readable.has(owner) ? `/records/${owner}/${id}` : null,
      types: this.typesOfClassOf(id),
      outgoing: detail.outgoing.map((item) => triple(item.predicate, item.value, item.type === 'uri')),
      incoming: detail.incoming.map((item) => triple(item.predicate, item.value, true)),
    };
  });

  private typesOfClassOf(id: string): NamedClass[] {
    const row = (this.individualsPage()?.items ?? []).find((item) => item.id === id);
    const types = row?.types ?? this.classIndex().get(this.selectedClass() ?? '')?.id ?? undefined;
    if (Array.isArray(types)) {
      return types
        .filter((local) => this.classIndex().has(local))
        .map((local) => ({ id: local, label: this.classIndex().get(local)?.label ?? local }));
    }
    const selected = this.selectedClass();
    return selected === null ? [] : [{ id: selected, label: this.classIndex().get(selected)?.label ?? selected }];
  }

  /** The nodes and edges actually drawn, after the class filter. */
  readonly graphNodes = computed<GraphNode[]>(() => {
    const nodes = this.payload()?.nodes ?? [];
    if (!this.filterByClass()) return nodes;
    const members = this.memberIds();
    if (members === null) return nodes;
    return nodes.filter((node) => members.has(node.id));
  });

  private readonly memberIds = computed<Set<string> | null>(() => {
    const selected = this.selectedClass();
    const page = this.individualsPage();
    if (selected === null || page === null || page.classLocal !== selected) return null;
    return new Set(page.items.map((item) => item.id));
  });

  readonly classNodeVisible = computed(() => this.selectedClass() !== null);

  readonly focusNode = computed<GraphNode | null>(() => {
    const id = this.focusId();
    if (id === null) return null;
    return this.payload()?.nodes.find((node) => node.id === id) ?? { id, label: id, group: 'other' };
  });

  readonly legend = computed<LegendEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const node of this.graphNodes()) counts.set(node.group, (counts.get(node.group) ?? 0) + 1);
    const groups = [...ENTITY_KEYS.filter((key) => counts.has(key)), ...(counts.has('other') ? ['other'] : [])];
    return groups.map((group) => ({
      group,
      label: this.familyLabel(group),
      token: `var(${FAMILY_TOKENS[group] ?? FAMILY_TOKENS['other']})`,
      count: counts.get(group) ?? 0,
    }));
  });

  private familyLabel(group: string): string {
    if (group === 'other') return this.translate.instant('explorer.legend.other');
    const entity = this.entityMetas().find((candidate) => candidate.key === group);
    return entity === undefined ? humanize(group) : entity.plural;
  }

  protected legendTitle(entry: LegendEntry): string {
    return this.translate.instant('explorer.legend.count', { label: entry.label, count: entry.count });
  }

  protected readonly drawnCount = computed(
    () => this.graphNodes().length + (this.classNodeVisible() ? 1 : 0),
  );

  protected readonly countsLine = computed(() => {
    const payload = this.payload();
    const kept = this.graphNodes();
    const edges = (payload?.edges ?? []).filter((edge) => this.edgeVisible(edge.source, edge.target));
    return this.translate.instant('explorer.graph.counts', {
      nodes: kept.length,
      edges: edges.length,
      loaded: payload?.nodes.length ?? 0,
    });
  });

  protected graphSubtitle(): string {
    return this.focusId() === null
      ? this.translate.instant('explorer.graph.subtitle')
      : this.translate.instant('explorer.graph.subtitleFocus', { depth: this.depth() });
  }

  protected graphEmptyHint(): string {
    return this.filterByClass()
      ? this.translate.instant('explorer.graph.emptyFiltered')
      : this.translate.instant('explorer.graph.emptyHint');
  }

  protected layoutOptions(): { value: LayoutName; label: string }[] {
    return (['cose', 'circle', 'grid', 'breadthfirst'] as LayoutName[]).map((value) => ({
      value,
      label: labelOf(this.translate, `explorer.layout.${value}`, value),
    }));
  }

  protected depthOptions(): { value: number; label: string }[] {
    return [1, 2, 3].map((value) => ({ value, label: String(value) }));
  }

  /** The SPARQL that produced the current neighbourhood, in the shape the API runs it. */
  readonly sparqlText = computed(() => {
    const base = this.namespace();
    const focus = this.focusId();
    const cap = this.limit();
    const head = base === null ? '' : `PREFIX ont: <${base}>\nPREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n\n`;
    if (base === null || focus === null) {
      return `${head}SELECT ?s ?p ?o WHERE {\n  ?s ?p ?o .\n  FILTER(isIri(?s) && isIri(?o))\n  FILTER(?p != rdf:type)\n}\nLIMIT ${cap}`;
    }
    const scoped = `  FILTER(STRSTARTS(STR(?s), "${base}") && STRSTARTS(STR(?o), "${base}"))\n`;
    return `${head}# neighbourhood of ont:${focus} at depth ${this.depth()}, ${cap} triples per level\nSELECT ?s ?p ?o WHERE {\n  {\n    VALUES ?s { ont:${focus} }\n    ?s ?p ?o .\n    FILTER(isIri(?o))\n  } UNION {\n    ?s ?p ?o .\n    VALUES ?o { ont:${focus} }\n    FILTER(isIri(?s))\n  }\n  FILTER(?p != rdf:type)\n${scoped}}\nLIMIT ${cap}`;
  });

  constructor() {
    this.meta.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ error: () => undefined });
    this.loadHierarchy();
    this.loadProperties();
    this.loadStats();
    afterNextRender({ write: () => this.createGraph() });
    effect(() => {
      const theme = this.theme.resolved();
      if (theme !== null && this.graph !== null) this.repaint();
    });
    this.destroyRef.onDestroy(() => this.disposeGraph());
  }

  // ---- data loading -------------------------------------------------------

  loadHierarchy(): void {
    this.treeLoading.set(true);
    this.treeError.set(false);
    this.ontology
      .hierarchy()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (payload) => {
          this.classes.set(payload.classes);
          this.treeLoading.set(false);
          if (this.selectedClass() === null) {
            const first = payload.classes[0];
            if (first !== undefined) this.selectClass(first.id);
          }
        },
        error: () => {
          this.treeLoading.set(false);
          this.treeError.set(true);
        },
      });
  }

  private loadStats(): void {
    this.ontology
      .stats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (stats) => this.stats.set(stats), error: () => undefined });
  }

  loadProperties(): void {
    this.propertiesLoading.set(true);
    this.propertiesError.set(false);
    this.ontology
      .properties()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.properties.set(rows);
          this.propertiesLoading.set(false);
          if (this.selectedProperty() === null) {
            const first = rows.find((row) => row.kind === 'object') ?? rows[0];
            if (first !== undefined) this.selectedProperty.set(first.name);
          }
        },
        error: () => {
          this.propertiesLoading.set(false);
          this.propertiesError.set(true);
        },
      });
  }

  loadGraph(): void {
    this.graphLoading.set(true);
    this.graphError.set(false);
    const focus = this.focusId();
    const request =
      focus === null ? this.ontology.graph(this.limit()) : this.ontology.neighbourhood(focus, this.depth(), this.limit());
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (payload) => {
        this.payload.set(payload);
        this.graphLoading.set(false);
        this.draw();
      },
      error: () => {
        this.graphLoading.set(false);
        this.graphError.set(true);
        this.toast.error(this.translate.instant('ui.error.title'), this.translate.instant('explorer.error.graph'));
      },
    });
  }

  loadIndividuals(): void {
    const selected = this.selectedClass();
    if (selected === null) {
      this.individualsPage.set(null);
      return;
    }
    this.individualsLoading.set(true);
    this.individualsError.set(false);
    const wanted = INDIVIDUALS_PAGE_SIZE * this.individualPage();
    this.ontology
      .individuals(selected, Math.min(500, Math.max(INDIVIDUALS_PAGE_SIZE, wanted)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.captureNamespace(page.items.map((item) => [item.iri, item.id] as const));
          this.individualsPage.set(page);
          this.individualsLoading.set(false);
        },
        error: () => {
          this.individualsLoading.set(false);
          this.individualsError.set(true);
        },
      });
  }

  private loadDetail(id: string): void {
    this.detailLoading.set(true);
    this.detailError.set(false);
    this.ontology
      .individual(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.captureNamespace([[detail.iri, detail.id] as const]);
          this.detail.set(detail);
          this.detailLoading.set(false);
        },
        error: () => {
          this.detail.set(null);
          this.detailLoading.set(false);
          this.detailError.set(true);
        },
      });
  }

  /** Reads the ontology namespace out of the IRIs the store returns. */
  private captureNamespace(pairs: readonly (readonly [string, string])[]): void {
    if (this.namespace() !== null) return;
    for (const [iri, id] of pairs) {
      if (iri.length > id.length && iri.endsWith(id)) {
        this.namespace.set(iri.slice(0, iri.length - id.length));
        return;
      }
    }
  }

  refreshAll(): void {
    this.loadHierarchy();
    this.loadProperties();
    this.loadStats();
    this.loadGraph();
    this.loadIndividuals();
  }

  // ---- selection ----------------------------------------------------------

  selectClass(id: string): void {
    this.selectedClass.set(id);
    this.individualPage.set(1);
    this.tab.set('classes');
    this.loadIndividuals();
    this.loadGraph();
  }

  selectIndividual(id: string): void {
    if (id.length === 0) return;
    this.focusId.set(id);
    this.tab.set('individuals');
    this.loadDetail(id);
    this.loadGraph();
  }

  clearFocus(): void {
    this.focusId.set(null);
    this.detail.set(null);
    this.loadGraph();
  }

  backToClass(): void {
    this.focusId.set(null);
    this.detail.set(null);
    this.tab.set('classes');
    this.loadGraph();
  }

  selectProperty(name: string): void {
    if (name.length === 0) return;
    this.selectedProperty.set(name);
    this.tab.set(this.properties().find((row) => row.name === name)?.kind === 'object' ? 'object' : 'data');
  }

  protected onPropertyTerm(event: Event): void {
    this.propertyTerm.set((event.target as HTMLInputElement).value.trim());
  }

  protected turnPage(step: number): void {
    const next = Math.min(Math.max(1, this.individualPage() + step), this.individualPages());
    if (next === this.individualPage()) return;
    this.individualPage.set(next);
    this.loadIndividuals();
  }

  protected toggleFilter(event: Event): void {
    this.filterByClass.set((event.target as HTMLInputElement).checked);
  }

  protected setLayout(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'cose' || value === 'circle' || value === 'grid' || value === 'breadthfirst') {
      this.layoutName.set(value);
      this.runLayout();
    }
  }

  protected setDepth(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (!Number.isFinite(value)) return;
    this.depth.set(Math.min(3, Math.max(1, Math.trunc(value))));
    if (this.focusId() !== null) this.loadGraph();
  }

  protected setLimit(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    this.limit.set(Math.min(500, Math.max(40, Math.trunc(value))));
    this.loadGraph();
  }

  protected setClassFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value.length === 0) {
      this.selectedClass.set(null);
      this.filterByClass.set(false);
      this.individualsPage.set(null);
      this.loadGraph();
      return;
    }
    this.selectClass(value);
  }

  protected expandTree(): void {
    this.tree()?.expandAll();
  }

  protected collapseTree(): void {
    this.tree()?.collapseAll();
  }

  protected toggleSparql(): void {
    this.sparqlOpen.update((open) => !open);
  }

  protected openConsole(): void {
    void this.router.navigateByUrl(`/tools/console?sparql=${encodeURIComponent(this.sparqlText())}`);
  }

  // ---- cytoscape ----------------------------------------------------------

  private edgeVisible(source: string, target: string): boolean {
    if (!this.filterByClass()) return true;
    const members = this.memberIds();
    if (members === null) return true;
    return members.has(source) && members.has(target);
  }

  private elementDefinitions(): cytoscape.ElementDefinition[] {
    const nodes = this.graphNodes();
    const payload = this.payload();
    const ids = new Set(nodes.map((node) => node.id));
    const definitions: cytoscape.ElementDefinition[] = nodes.map((node) => ({
      group: 'nodes',
      data: { id: node.id, label: node.label, family: node.group },
      classes: `family-${node.group}${node.id === this.focusId() ? ' is-focus' : ''}`,
    }));
    const seen = new Set<string>();
    (payload?.edges ?? []).forEach((edge, index) => {
      if (!ids.has(edge.source) || !ids.has(edge.target)) return;
      const key = `${edge.source}|${edge.label}|${edge.target}`;
      if (seen.has(key)) return;
      seen.add(key);
      definitions.push({
        group: 'edges',
        data: { id: `e${index}-${key}`, source: edge.source, target: edge.target, label: edge.label },
      });
    });

    const selected = this.selectedClass();
    if (selected !== null) {
      const card = this.classCard();
      definitions.push({
        group: 'nodes',
        data: { id: `class:${selected}`, label: card?.label ?? selected, family: 'class' },
        classes: 'is-class',
      });
      for (const node of nodes) {
        if (!this.isMemberOf(node.id, selected)) continue;
        definitions.push({
          group: 'edges',
          data: {
            id: `type-${selected}-${node.id}`,
            source: `class:${selected}`,
            target: node.id,
            label: 'a',
          },
          classes: 'is-type',
        });
      }
    }
    return definitions;
  }

  private isMemberOf(id: string, classLocal: string): boolean {
    const members = this.memberIds();
    if (members !== null) return members.has(id);
    const row = (this.individualsPage()?.items ?? []).find((item) => item.id === id);
    return row === undefined ? false : row.types.includes(classLocal);
  }

  private cssVar(token: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  }

  /** Design tokens resolved for the canvas, so light and dark both paint correctly. */
  protected tokenValue(token: string): string {
    return this.cssVar(token);
  }

  protected setTab(value: string): void {
    if (value === 'classes' || value === 'object' || value === 'data' || value === 'individuals') this.tab.set(value);
  }

  private stylesheet(): cytoscape.StylesheetJson {
    const families = Object.entries(FAMILY_TOKENS).map(([group, token]) => ({
      selector: `node.family-${group}`,
      style: { 'background-color': this.cssVar(token) },
    }));
    return [
      {
        selector: 'node',
        style: {
          'shape': 'ellipse',
          'width': 26,
          'height': 26,
          'background-opacity': 0.92,
          'border-width': 2,
          'border-color': this.cssVar('--bg-sunken'),
          'label': 'data(label)',
          'color': this.cssVar('--text'),
          'font-size': 11,
          'font-family': this.cssVar('--font-sans'),
          'text-valign': 'bottom',
          'text-wrap': 'ellipsis',
          'text-max-width': '96px',
          'min-zoomed-font-size': 7,
        },
      },
      {
        selector: 'node.is-class',
        style: {
          'shape': 'diamond',
          'width': 34,
          'height': 34,
          'background-color': this.cssVar(CLASS_NODE_TOKEN),
          'border-color': this.cssVar('--surface'),
          'border-width': 3,
          'font-weight': 700,
          'text-valign': 'top',
        },
      },
      ...families,
      {
        selector: 'edge',
        style: {
          'width': 1.6,
          'line-color': this.cssVar('--border-strong'),
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': this.cssVar('--border-strong'),
          'label': 'data(label)',
          'color': this.cssVar('--text-subtle'),
          'font-size': 9,
          'font-family': this.cssVar('--font-sans'),
          'text-rotation': 'autorotate',
          'min-zoomed-font-size': 9,
        },
      },
      {
        selector: 'edge.is-type',
        style: {
          'line-color': this.cssVar('--text-subtle'),
          'line-style': 'dashed',
          'target-arrow-color': this.cssVar('--text-subtle'),
        },
      },
      {
        selector: 'node.is-focus',
        style: {
          'width': 34,
          'height': 34,
          'border-color': this.cssVar('--primary'),
          'border-width': 4,
          'background-opacity': 1,
          'font-weight': 700,
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-color': this.cssVar('--primary-hover'),
          'border-width': 4,
          'background-opacity': 1,
        },
      },
      {
        selector: 'edge:selected',
        style: {
          'line-color': this.cssVar('--primary'),
          'target-arrow-color': this.cssVar('--primary'),
          'width': 3,
        },
      },
    ];
  }

  private createGraph(): void {
    const host = this.viewport()?.nativeElement;
    if (host === undefined || host === null || this.graph !== null) return;
    const graph = cytoscape({
      container: host,
      elements: this.elementDefinitions(),
      style: this.stylesheet(),
      layout: { name: 'preset' },
      wheelSensitivity: 0.2,
      minZoom: 0.3,
      maxZoom: 3,
      boxSelectionEnabled: false,
    });
    graph.on('tap', 'node', (event: cytoscape.EventObjectNode) => this.onNodeTap(event.target.id()));
    graph.on('dbltap', 'node', (event: cytoscape.EventObjectNode) => this.onNodeDblTap(event.target.id()));
    this.graph = graph;
    this.runLayout(true);
    this.loadGraph();
  }

  private disposeGraph(): void {
    if (this.tapTimer !== null) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }
    this.activeLayout?.stop();
    this.activeLayout = null;
    this.graph?.stop();
    this.graph?.destroy();
    this.graph = null;
  }

  private repaint(): void {
    const graph = this.graph;
    if (graph === null) return;
    graph.style(this.stylesheet());
  }

  private draw(): void {
    const graph = this.graph;
    if (graph === null) return;
    graph.batch(() => {
      graph.style(this.stylesheet());
      graph.elements().remove();
      graph.add(this.elementDefinitions());
    });
    graph.resize();
    this.runLayout();
  }

  private layoutOptionsFor(initial: boolean): cytoscape.LayoutOptions {
    const animate = !this.reduceMotion && !initial;
    const shared = { fit: true, padding: 24, animate, animationDuration: animate ? 300 : 0, avoidOverlap: true };
    const name = this.layoutName();
    if (name === 'cose') {
      return { ...shared, name: 'cose', nodeRepulsion: 9000, idealEdgeLength: 90, gravity: 60, refresh: 2 };
    }
    if (name === 'circle') return { ...shared, name: 'circle', spacingFactor: 1.2 };
    if (name === 'grid') return { ...shared, name: 'grid', condense: true };
    const focus = this.focusId();
    return { ...shared, name: 'breadthfirst', directed: true, roots: focus === null ? undefined : [focus] };
  }

  private runLayout(initial = false): void {
    const graph = this.graph;
    if (graph === null || graph.nodes().length === 0) return;
    this.activeLayout?.stop();
    const layout = graph.layout(this.layoutOptionsFor(initial));
    this.activeLayout = layout;
    layout.one('layoutstop', () => {
      if (this.activeLayout === layout) this.activeLayout = null;
    });
    layout.run();
  }

  private onNodeTap(id: string): void {
    if (id.startsWith('class:')) {
      this.selectClass(id.slice('class:'.length));
      return;
    }
    if (this.tapTimer !== null) clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      this.selectIndividual(id);
    }, 260);
  }

  /** A double click keeps the focus and widens the neighbourhood by one level. */
  private onNodeDblTap(id: string): void {
    if (this.tapTimer !== null) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }
    if (id.startsWith('class:')) {
      this.selectClass(id.slice('class:'.length));
      return;
    }
    const same = this.focusId() === id;
    if (same) this.depth.set(Math.min(3, this.depth() + 1));
    this.focusId.set(id);
    this.tab.set('individuals');
    this.loadDetail(id);
    this.loadGraph();
  }

  protected zoomIn(): void {
    const graph = this.graph;
    if (graph === null) return;
    graph.zoom(Math.min(3, graph.zoom() * 1.3));
  }

  protected zoomOut(): void {
    const graph = this.graph;
    if (graph === null) return;
    graph.zoom(Math.max(0.3, graph.zoom() / 1.3));
  }

  protected fitView(): void {
    this.graph?.fit(undefined, 24);
  }
}
