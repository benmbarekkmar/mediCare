import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NlpService } from '../../core/api/nlp.service';
import { AuthService } from '../../core/auth/auth.service';
import { HealthService, type HealthPayload } from '../../core/api/insight.service';
import { ToastService } from '../../core/toast/toast.service';
import type { AskResult, EntityKey, NlpEntity, NlpParse } from '../../core/api/models';
import { downloadCsv } from '../../core/util/csv';
import { formatDateTime, percent } from '../../core/util/format';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiBadgeComponent } from '../../shared/ui/badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiChipComponent } from '../../shared/ui/chip/ui-chip.component';
import { UiCodeBlockComponent } from '../../shared/ui/code-block/ui-code-block.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton/ui-skeleton.component';
import { UiTabsComponent, type UiTab } from '../../shared/ui/tabs/ui-tabs.component';
import { UiEmptyStateComponent } from '../../shared/ui/empty-state/ui-empty-state.component';
import { UiErrorStateComponent } from '../../shared/ui/error-state/ui-error-state.component';
import type { IconName } from '../../shared/ui/icon/icons';

/** The current question and its response while the translator is open. */
interface ChatTurn {
  readonly id: string;
  readonly question: string;
  readonly sentAt: string;
  readonly pending: boolean;
  readonly answer: AskResult | null;
  readonly error: string | null;
}

interface RecentSearch {
  readonly question: string;
  readonly intent: string | null;
}

interface ServiceStatus {
  readonly key: string;
  readonly label: string;
  readonly state: 'online' | 'offline' | 'checking';
  readonly statusLabel: string;
}

type PipelineStageState = 'complete' | 'failed' | 'skipped';

interface PipelineStage {
  readonly id: string;
  readonly icon: IconName;
  readonly label: string;
  readonly state: PipelineStageState;
  readonly detail: string;
}

interface ScoreRow {
  readonly name: string;
  readonly value: string;
  readonly width: string;
}

/** The Web Speech API is not in the DOM lib: the shape is declared locally. */
interface SpeechAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechAlternative;
}

interface SpeechResultList {
  readonly length: number;
  item(index: number): SpeechResult;
}

interface SpeechEvent {
  readonly results: SpeechResultList;
  readonly resultIndex: number;
}

interface SpeechErrorEvent {
  readonly error: string;
}

interface SpeechHandle {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechConstructor = new () => SpeechHandle;

const CONSOLE_PATH = '/tools/console';
const SPEECH_KEYS = ['SpeechRecognition', 'webkitSpeechRecognition'] as const;

/** The class locals the REST registry serves, mapped to the records routes. */
const RECORD_ENTITY_BY_CLASS: Record<string, EntityKey> = {
  Patient: 'patients',
  Doctor: 'doctors',
  Disease: 'diseases',
  Symptom: 'symptoms',
  Treatment: 'treatments',
  Medication: 'medications',
  MedicalTest: 'tests',
  MedicalAppointment: 'appointments',
  Hospital: 'hospitals',
  MedicalDepartment: 'departments',
};

/** The individual slots the NLP service fills, mapped to the same route keys. */
const RECORD_ENTITY_BY_SLOT: Record<string, EntityKey> = {
  patient: 'patients',
  doctor: 'doctors',
  disease: 'diseases',
  symptom: 'symptoms',
  treatment: 'treatments',
  medication: 'medications',
  test: 'tests',
  appointment: 'appointments',
  hospital: 'hospitals',
  department: 'departments',
};

/** The four id styles the registry spells with a class prefix. */
const RECORD_ENTITY_BY_PREFIX: Record<string, EntityKey> = {
  Patient: 'patients',
  Doctor: 'doctors',
  Appointment: 'appointments',
  Hospital: 'hospitals',
};

const speechKey = (): (typeof SPEECH_KEYS)[number] | null =>
  SPEECH_KEYS.find((key) => key in window) ?? null;

const speechConstructor = (): SpeechConstructor | null => {
  const key = speechKey();
  if (key === null) return null;
  const scope = window as unknown as Record<string, unknown>;
  const candidate = scope[key];
  return typeof candidate === 'function' ? (candidate as SpeechConstructor) : null;
};

let turnSequence = 0;
const nextTurnId = (): string => `t${Date.now().toString(36)}x${(turnSequence += 1)}`;

/**
 * Natural language to SPARQL translator using Python/spaCy, RDFLib and Apache Jena Fuseki.
 * The same component serves the staff tools menu and the patient portal; mounted
 * with `data: { portal: true }` it drops to a narrower, friendlier layout.
 */
@Component({
  selector: 'page-assistant',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslateModule,
    UiAlertComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiChipComponent,
    UiCodeBlockComponent,
    UiEmptyStateComponent,
    UiErrorStateComponent,
    UiIconComponent,
    UiSkeletonComponent,
    UiTabsComponent,
  ],
  template: `
    <div class="page chat translator" [class.chat--portal]="portal">
      <header class="search-hero">
        <div class="search-hero__copy">
          <span class="search-hero__icon"><ui-icon name="heart" [size]="23" /></span>
          <div>
            <p class="search-hero__eyebrow">{{ 'translator.heroEyebrow' | translate }}</p>
            <h1>{{ 'translator.searchTitle' | translate }}</h1>
            <p class="search-hero__subtitle">{{ 'translator.searchSubtitle' | translate }}</p>
          </div>
        </div>
        <div class="service-status" role="list" aria-live="polite" aria-atomic="false"
          [attr.aria-label]="'translator.status.label' | translate" [attr.aria-busy]="healthPayload() === null">
          @for (service of serviceStatuses(); track service.key) {
            <div [class]="'service-status__item service-status__item--' + service.state" role="listitem">
              <span class="service-status__icon"><ui-icon [name]="serviceIcon(service.key)" [size]="16" /></span>
              <span class="service-status__dot" [class]="'service-status__dot service-status__dot--' + service.state" aria-hidden="true"></span>
              <span class="service-status__copy">
                <span class="service-status__name">{{ service.label | translate }}</span>
                <span class="service-status__state">{{ service.statusLabel | translate }}</span>
              </span>
            </div>
          }
        </div>
      </header>

      @if (booting()) {
        <div class="chat__boot" aria-busy="true" [attr.aria-label]="'common.loading' | translate">
          <ui-skeleton height="108px" [radius]="'var(--radius-card)'" [announce]="false"></ui-skeleton>
          <ui-skeleton height="180px" [radius]="'var(--radius-card)'" [announce]="false"></ui-skeleton>
          <ui-skeleton [lines]="3" [announce]="false"></ui-skeleton>
        </div>
      } @else {
        <div class="chat__layout">
          <section class="chat__main">
            <div
              #thread
              class="thread"
              role="log"
              aria-live="polite"
              [attr.aria-label]="'translator.outputLabel' | translate"
              [attr.aria-busy]="busy()"
            >
              @if (turns().length === 0) {
                <ui-empty-state
                  icon="database"
                  [title]="'translator.emptyTitle' | translate"
                  [hint]="'translator.emptyHint' | translate"
                />
              }
              @for (turn of turns(); track turn.id) {
                <article class="turn" [class.turn--active]="activeTurn() === turn.id" [attr.data-turn]="turn.id">
                  @if (!turn.answer) {
                    <p class="bubble">
                      <span class="bubble__who">{{ 'translator.questionEcho' | translate }}</span>
                      <span class="bubble__text">{{ turn.question }}</span>
                    </p>
                  }

                  @if (turn.pending) {
                    <div class="pending">
                      <span class="pending__label">
                        <ui-icon name="loader" [size]="16" />
                        {{ 'translator.pending' | translate }}
                      </span>
                      <div class="pending__steps" aria-hidden="true">
                        <span>{{ 'translator.status.nlp.label' | translate }}</span>
                        <span>{{ 'translator.pendingStepQuery' | translate }}</span>
                        <span>{{ 'translator.status.sparql.label' | translate }}</span>
                      </div>
                      <div class="pending__skeletons">
                        <ui-skeleton [lines]="3" [announce]="false" />
                        <ui-skeleton [lines]="3" [announce]="false" />
                      </div>
                    </div>
                  } @else {
                    @if (turn.answer; as answer) {
                    <div class="answer" [attr.dir]="directionOf(answer.parse)">
                      <p class="answer__who">
                        <ui-icon name="list-checks" [size]="16" />
                        <span class="answer__text">{{ 'translator.resultTitle' | translate }}</span>
                        <span class="answer__at">{{ timeOf(turn) }}</span>
                      </p>

                      <section class="result-summary" [attr.aria-label]="'translator.summary.label' | translate">
                        <div class="result-summary__question">
                          <span>{{ 'translator.summary.question' | translate }}</span>
                          <p>{{ answer.parse.question || turn.question }}</p>
                        </div>
                        <dl class="summary-stats">
                          <div class="summary-stat">
                            <dt>{{ 'translator.summary.intent' | translate }}</dt>
                            <dd><ui-badge kind="neutral" [label]="assignmentIntent(answer.parse)" /></dd>
                          </div>
                          <div class="summary-stat">
                            <dt>{{ 'translator.summary.language' | translate }}</dt>
                            <dd>{{ languageOf(answer.parse) }}</dd>
                          </div>
                          <div class="summary-stat">
                            <dt>{{ 'translator.summary.count' | translate }}</dt>
                            <dd>{{ resultCountLabel(answer.rows.length) }}</dd>
                          </div>
                          <div class="summary-stat">
                            <dt>{{ 'translator.summary.executionTime' | translate }}</dt>
                            <dd>{{ 'translator.summary.milliseconds' | translate: { ms: answer.executionMs } }}</dd>
                          </div>
                        </dl>
                        <div class="confidence-meter">
                          <div class="confidence-meter__label">
                            <span>{{ 'translator.analysisConfidence' | translate }}</span>
                            <strong>{{ confidenceOf(answer.parse) }}</strong>
                          </div>
                          <div
                            class="confidence-meter__track"
                            [class]="'confidence-meter__track confidence-meter__track--' + confidenceKind(answer.parse)"
                            role="meter"
                            [attr.aria-label]="'translator.analysisConfidence' | translate"
                            [attr.aria-valuemin]="0"
                            [attr.aria-valuemax]="100"
                            [attr.aria-valuenow]="confidencePercent(answer.parse)"
                            [attr.aria-valuetext]="confidenceOf(answer.parse)"
                          >
                            <span [style.width.%]="confidencePercent(answer.parse)"></span>
                          </div>
                        </div>
                      </section>

                      @if (answer.parse.reply) {
                        <p class="reply">{{ answer.parse.reply }}</p>
                      }

                      <div class="block">
                        <p class="block__label">{{ 'translator.results.label' | translate }}</p>
                        @if (answer.parse.intent === 'not_understood') {
                          <ui-alert kind="warning" [title]="'translator.unsupportedTitle' | translate">
                            <p class="fallback__hint">{{ 'translator.unsupportedHint' | translate }}</p>
                            <div class="chips">
                              @for (suggestion of answer.parse.suggestions; track suggestion) {
                                <button type="button" class="chip-btn" [disabled]="busy()" (click)="selectQuestion(suggestion)">
                                  <ui-chip [label]="suggestion" icon="search" />
                                </button>
                              }
                            </div>
                          </ui-alert>
                        } @else if (answer.rows.length === 0) {
                          <ui-empty-state compact icon="inbox"
                            [title]="'translator.results.empty' | translate"
                            [hint]="'translator.results.emptyHint' | translate" />
                        } @else {
                          <ul class="rows">
                            @for (row of answer.rows; track $index) {
                              <li class="row-card">
                                <span class="row-card__icon"><ui-icon [name]="resultIcon(answer.parse)" [size]="18" /></span>
                                <div class="row-card__content">
                                  <h3>{{ rowTitle(answer, row) }}</h3>
                                  @if (rowDetails(answer, row).length > 0) {
                                    <dl>
                                      @for (field of rowDetails(answer, row); track field.key) {
                                        <div>
                                          <dt><ui-icon [name]="fieldIcon(field.key)" [size]="14" /><span>{{ field.label }}</span></dt>
                                          <dd>{{ field.value }}</dd>
                                        </div>
                                      }
                                    </dl>
                                  }
                                </div>
                              </li>
                            }
                          </ul>
                        }
                        <div class="block__tools">
                          <ui-button
                            variant="ghost"
                            size="sm"
                            icon="download"
                            [disabled]="answer.rows.length === 0"
                            (click)="exportCsv(answer)"
                          >
                            {{ 'common.export' | translate }}
                          </ui-button>
                        </div>
                      </div>

                      @if (answer.semanticPaths?.length) {
                        <section class="block semantic-explanations">
                          <div>
                            <p class="block__label">{{ 'translator.path.title' | translate }}</p>
                            <p class="block__meta">{{ 'translator.path.hint' | translate }}</p>
                          </div>
                          <ul class="semantic-paths">
                            @for (path of answer.semanticPaths ?? []; track $index) {
                              <li class="semantic-path">
                                <div class="semantic-path__chain" [attr.aria-label]="'translator.path.chain' | translate">
                                  @for (node of path.nodes; track node.id; let index = $index) {
                                    @if (index > 0) {
                                      <span class="semantic-path__relation">{{ ('translator.path.predicates.' + path.predicates[index - 1]) | translate }}</span>
                                    }
                                    @if (portal) {
                                      <span class="semantic-path__node">{{ node.label }}</span>
                                    } @else {
                                      <a class="semantic-path__node semantic-path__node--link"
                                        [routerLink]="['/tools/explorer']"
                                        [queryParams]="{ focus: node.id }"
                                        [attr.title]="'translator.path.open' | translate: { label: node.label }">{{ node.label }}</a>
                                    }
                                  }
                                </div>
                              </li>
                            }
                          </ul>
                        </section>
                      }

                      <section class="pipeline" [attr.aria-label]="'translator.pipeline.title' | translate">
                        <div class="pipeline__heading">
                          <ui-icon name="route" [size]="17" />
                          <h3>{{ 'translator.pipeline.title' | translate }}</h3>
                        </div>
                        <ol class="pipeline-timeline">
                          @for (stage of pipelineStages(answer, turn.question); track stage.id) {
                            <li [class]="'pipeline-stage pipeline-stage--' + stage.state">
                              <span class="pipeline-stage__marker" aria-hidden="true">
                                <ui-icon [name]="stage.icon" [size]="17" />
                              </span>
                              <div class="pipeline-stage__body">
                                <div class="pipeline-stage__title">
                                  <h4>{{ stage.label | translate }}</h4>
                                  <ui-badge [kind]="pipelineStatusKind(stage.state)"
                                    [label]="'translator.pipeline.state.' + stage.state | translate" />
                                </div>
                                <p dir="auto">{{ stage.detail }}</p>
                              </div>
                            </li>
                          }
                        </ol>
                      </section>

                      <details class="disclosure technical">
                        <summary class="disclosure__summary">
                          <ui-icon name="chevron-down" [size]="14" />
                          <span>{{ 'translator.technicalTitle' | translate }}</span>
                        </summary>
                        <div class="disclosure__body">
                          <ui-tabs [tabs]="technicalTabs()" [(active)]="technicalTab">
                            @if (technicalTab() === 'analysis') {
                            <div class="technical__content">
                              <p><strong>{{ 'translator.questionEcho' | translate }}:</strong> {{ answer.parse.question }}</p>
                              <p><strong>{{ 'translator.analysisLanguage' | translate }}:</strong> {{ languageOf(answer.parse) }}</p>
                              <p><strong>{{ 'translator.analysisIntent' | translate }}:</strong> {{ assignmentIntent(answer.parse) }}</p>
                              <p><strong>{{ 'translator.analysisConfidence' | translate }}:</strong> {{ confidenceOf(answer.parse) }}</p>
                              @if (answer.parse.entities.length > 0) {
                                <div class="block">
                                  <p class="block__label">{{ 'translator.entities.label' | translate }}</p>
                                  <div class="chips">
                                    @for (entity of answer.parse.entities; track $index) {
                                      <ui-chip [count]="scoreOf(entity)">
                                        <span class="ent" [class]="'ent ent--' + entity.type">
                                          <span class="ent__dot" aria-hidden="true"></span>
                                          @if (entityHref(entity, answer); as href) {
                                            <a class="ent__link truncate" [routerLink]="href"
                                              [attr.title]="'translator.entities.open' | translate: { label: entity.label }">{{ entity.label }}</a>
                                          } @else {
                                            <span class="truncate">{{ entity.label }}</span>
                                          }
                                        </span>
                                      </ui-chip>
                                    }
                                  </div>
                                </div>
                              }
                              @if (explanationOf(answer.parse)) {
                                <p><strong>{{ 'translator.interpretation' | translate }}:</strong> {{ explanationOf(answer.parse) }}</p>
                              }
                              <ol class="steps">
                                @for (step of answer.parse.pipeline; track $index) {
                                  <li class="step">
                                    <span class="step__name font-mono">{{ step.step }}</span>
                                    <span class="step__detail">{{ step.detail }}</span>
                                    <span class="step__tool text-muted text-sm">{{ step.tool }}</span>
                                  </li>
                                }
                              </ol>
                              @if (scores(answer.parse).length > 0) {
                                <p class="block__label">{{ 'translator.scores' | translate }}</p>
                                <ul class="scores">
                                  @for (row of scores(answer.parse); track row.name) {
                                    <li class="score">
                                      <span class="score__name font-mono truncate">{{ row.name }}</span>
                                      <span class="score__bar"><span class="score__fill" [style.width]="row.width"></span></span>
                                      <span class="score__value">{{ row.value }}</span>
                                    </li>
                                  }
                                </ul>
                              }
                            </div>
                            } @else if (technicalTab() === 'sparql') {
                            <div class="technical__content">
                              @if (queryOf(answer)) {
                                <ui-code-block language="sparql" [code]="queryOf(answer)"
                                  [label]="'translator.sparql' | translate" [maxHeight]="'320px'" />
                                @if (isAdmin()) {
                                  <a class="console__link" [routerLink]="consolePath"
                                    [queryParams]="{ sparql: queryOf(answer) }">
                                    <ui-button variant="outline" size="sm" icon="external-link">
                                      {{ 'ui.code.openConsole' | translate }}
                                    </ui-button>
                                  </a>
                                }
                              } @else {
                                <p>{{ 'translator.noQuery' | translate }}</p>
                              }
                            </div>
                            } @else {
                            <div class="technical__content execution-meta">
                              <p><strong>{{ 'translator.executionStatus' | translate }}:</strong>
                                {{ (answer.sparql ? 'translator.executionComplete' : 'translator.executionSkipped') | translate }}</p>
                              <p><strong>{{ 'translator.results.label' | translate }}:</strong> {{ answer.rows.length }}</p>
                              <p><strong>{{ 'translator.executionTime' | translate }}:</strong> {{ answer.executionMs }} ms</p>
                            </div>
                            }
                          </ui-tabs>
                        </div>
                      </details>
                    </div>
                    } @else if (turn.error) {
                    <ui-error-state
                      [title]="'ui.error.title' | translate"
                      [message]="turn.error"
                      [hint]="'translator.errorHint' | translate"
                      (retry)="ask(turn.question)"
                    />
                    }
                  }
                </article>
              }
            </div>

            <div class="composer">
              <label class="composer__label" for="assistant-input">{{ 'translator.questionLabel' | translate }}</label>
              <div class="composer__entry">
                <span class="composer__assistant-icon" aria-hidden="true"><ui-icon name="bot" [size]="22" /></span>
                <textarea
                  id="assistant-input"
                  class="ui-control composer__input"
                  rows="2"
                  [value]="draft()"
                  [disabled]="busy()"
                  [placeholder]="'translator.searchPlaceholder' | translate"
                  (input)="onInput($event)"
                  (keydown)="onComposerKeydown($event)"
                ></textarea>
                @if (voiceSupported) {
                  <ui-button
                    class="composer__voice"
                    variant="outline"
                    size="sm"
                    [icon]="listening() ? 'x' : 'mic'"
                    [disabled]="busy()"
                    [attr.aria-pressed]="listening()"
                    (click)="toggleVoice()"
                  >
                    {{ (listening() ? 'translator.voice.stop' : 'translator.voice.start') | translate }}
                  </ui-button>
                }
                <ui-button class="composer__submit" icon="search" size="sm" [loading]="busy()" [disabled]="!canSend()" (click)="send()">
                  {{ 'translator.run' | translate }}
                </ui-button>
              </div>
              <div class="composer__row">
                <p class="composer__hint text-muted text-sm">{{ 'translator.questionHint' | translate }}</p>
                <div class="composer__buttons">
                  @if (draft().length > 0 || turns().length > 0) {
                    <ui-button variant="outline" size="sm" icon="x" [disabled]="busy()" (click)="clearSearch()">
                      {{ 'translator.clear' | translate }}
                    </ui-button>
                  }
                </div>
              </div>
              <div class="suggestions">
                <span class="suggestions__label">{{ 'translator.tryAsking' | translate }}</span>
                <div class="suggestions__list">
                  @for (sample of sampleQuestions(); track sample; let index = $index) {
                    <button type="button" class="suggestion" [disabled]="busy()" (click)="selectQuestion(sample)">
                      <ui-icon [name]="sampleIcon(index)" [size]="14" />
                      <span>{{ sample }}</span>
                    </button>
                  }
                </div>
              </div>
            </div>
          </section>
          <aside class="chat__aside" [attr.aria-label]="'translator.aside.label' | translate">
            <section class="aside-panel recent-panel">
              <div class="aside-panel__heading">
                <span class="aside-panel__icon"><ui-icon name="clock" [size]="17" /></span>
                <div>
                  <h2>{{ 'translator.recentTitle' | translate }}</h2>
                  <p>{{ 'translator.recentSession' | translate }}</p>
                </div>
              </div>
              @if (recentSearches().length > 0) {
                <ul class="recent-list">
                  @for (search of recentSearches(); track search.question) {
                    <li>
                      <button type="button" class="recent-item" [disabled]="busy()" (click)="selectQuestion(search.question)">
                        <ui-icon name="search" [size]="14" />
                        <span class="recent-item__copy">
                          <span class="recent-item__question">{{ search.question }}</span>
                          @if (search.intent) { <ui-badge kind="neutral" [label]="search.intent" /> }
                        </span>
                        <ui-icon name="chevron-right" [size]="15" />
                      </button>
                    </li>
                  }
                </ul>
              } @else {
                <p class="recent-panel__empty">{{ 'translator.recentEmpty' | translate }}</p>
              }
            </section>

            <section class="aside-panel tips-panel">
              <div class="aside-panel__heading">
                <span class="aside-panel__icon aside-panel__icon--accent"><ui-icon name="sparkles" [size]="17" /></span>
                <div><h2>{{ 'translator.tips.title' | translate }}</h2></div>
              </div>
              <ul class="tips-list">
                <li><ui-icon name="check" [size]="14" /><span>{{ 'translator.tips.specific' | translate }}</span></li>
                <li><ui-icon name="check" [size]="14" /><span>{{ 'translator.tips.languages' | translate }}</span></li>
                <li><ui-icon name="check" [size]="14" /><span>{{ 'translator.tips.access' | translate }}</span></li>
              </ul>
            </section>
          </aside>
        </div>
        <section class="domain-examples" [attr.aria-label]="'translator.domains.title' | translate">
          <div class="domain-examples__heading">
            <div><h2>{{ 'translator.domains.title' | translate }}</h2><p>{{ 'translator.domains.hint' | translate }}</p></div>
          </div>
          <div class="domain-grid">
            @for (sample of sampleQuestions(); track sample; let index = $index) {
              <button type="button" class="domain-card" [disabled]="busy()" (click)="selectQuestion(sample)">
                <span class="domain-card__icon" [class]="'domain-card__icon domain-card__icon--' + index">
                  <ui-icon [name]="sampleIcon(index)" [size]="17" />
                </span>
                <span class="domain-card__copy">
                  <strong>{{ 'translator.domains.items.' + index + '.title' | translate }}</strong>
                  <span>{{ 'translator.domains.items.' + index + '.description' | translate }}</span>
                </span>
                <ui-icon class="domain-card__arrow" name="chevron-right" [size]="15" />
              </button>
            }
          </div>
        </section>
      }

    </div>
  `,
  // The page-specific visual layer lives in the namespaced global partial so
  // its responsive polish does not inflate Angular's per-component CSS budget.
  styles: [],
})
export class AssistantComponent {
  private readonly nlp = inject(NlpService);
  private readonly health = inject(HealthService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  /** The patient portal mounts this same component with `data: { portal: true }`. */
  protected readonly portal = inject(ActivatedRoute).snapshot.data['portal'] === true;
  protected readonly consolePath = CONSOLE_PATH;

  protected readonly turns = signal<ChatTurn[]>([]);
  protected readonly draft = signal('');
  protected readonly healthPayload = signal<HealthPayload | null>(null);
  protected readonly booting = signal(false);
  protected readonly busy = computed(() => this.turns().some((turn) => turn.pending));
  protected readonly canSend = computed(() => this.draft().trim().length > 0 && !this.busy());

  protected readonly activeTurn = signal<string | null>(null);
  protected readonly recentSearches = signal<RecentSearch[]>([]);
  protected readonly technicalTab = model('analysis');
  protected readonly listening = signal(false);
  protected readonly isAdmin = computed(() => this.auth.hasRole('ADMIN'));
  protected readonly voiceSupported = speechKey() !== null;
  protected readonly serviceStatuses = computed<ServiceStatus[]>(() => {
    const health = this.healthPayload();
    const nlp = health?.nlp.ok ?? null;
    const store = health?.tripleStore.ok ?? null;
    const status = (value: boolean | null): ServiceStatus['state'] =>
      value === null ? 'checking' : value ? 'online' : 'offline';
    return [
      { key: 'nlp', label: 'translator.status.nlp.label', state: status(nlp), statusLabel: `translator.status.nlp.${status(nlp)}` },
      { key: 'ontology', label: 'translator.status.ontology.label', state: status(store), statusLabel: `translator.status.ontology.${status(store)}` },
      { key: 'sparql', label: 'translator.status.sparql.label', state: status(store), statusLabel: `translator.status.sparql.${status(store)}` },
    ];
  });

  /** Read as methods, not computeds: a language switch must re-read every label. */
  protected sampleQuestions(): string[] {
    const samples: unknown = this.translate.instant('translator.sampleQuestions');
    return Array.isArray(samples) ? samples.filter((item): item is string => typeof item === 'string') : [];
  }

  protected technicalTabs(): UiTab[] {
    return [
      { id: 'analysis', label: this.translate.instant('translator.analysisTitle'), icon: 'activity' },
      { id: 'sparql', label: this.translate.instant('translator.sparql'), icon: 'database' },
      { id: 'execution', label: this.translate.instant('translator.executionTitle'), icon: 'zap' },
    ];
  }

  /** Samples and recent searches only fill the input; submission stays explicit. */
  protected selectQuestion(question: string): void {
    this.draft.set(question);
  }

  protected clearSearch(): void {
    if (this.busy()) return;
    this.stopVoice();
    this.draft.set('');
    this.turns.set([]);
    this.activeTurn.set(null);
  }

  private readonly thread = viewChild<HTMLElement>('thread');
  private recognition: SpeechHandle | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopVoice());
    this.health
      .check()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (payload) => this.healthPayload.set(payload),
        error: () => this.healthPayload.set({ ok: false, tripleStore: { ok: false }, nlp: { ok: false } }),
      });
  }

  protected lang(): 'en' | 'fr' {
    return this.translate.currentLang === 'fr' ? 'fr' : 'en';
  }

  protected ask(question: string): void {
    const text = question.trim();
    if (text.length === 0 || this.busy()) return;
    const id = nextTurnId();
    this.recentSearches.update((items) => [{ question: text, intent: null }, ...items.filter((item) => item.question !== text)].slice(0, 5));
    this.commit([{ id, question: text, sentAt: new Date().toISOString(), pending: true, answer: null, error: null }]);
    this.draft.set('');
    this.activeTurn.set(id);
    this.scrollToEnd();
    this.nlp
      .ask(text)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => this.settle(id, result, null),
        error: (failure: unknown) => this.settle(id, null, this.friendlyError(failure)),
      });
  }

  protected send(): void {
    this.ask(this.draft());
  }

  protected onInput(event: Event): void {
    const target = event.target;
    this.draft.set(target instanceof HTMLTextAreaElement ? target.value : '');
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    this.send();
  }

  protected languageOf(parse: NlpParse): string {
    if (parse.language === 'ar') return this.translate.instant('translator.language.ar');
    if (parse.language === 'tn') return this.translate.instant('translator.language.tn');
    return this.translate.instant('translator.language.' + (parse.language === 'fr' ? 'fr' : 'en'));
  }

  protected directionOf(parse: NlpParse): 'rtl' | 'ltr' {
    return parse.language === 'ar' || parse.language === 'tn' ? 'rtl' : 'ltr';
  }

  protected confidenceOf(parse: NlpParse): string {
    return this.translate.instant('translator.confidence', { value: percent(parse.confidence * 100) });
  }

  protected confidencePercent(parse: NlpParse): number {
    const confidence = Number.isFinite(parse.confidence) ? parse.confidence * 100 : 0;
    return Math.round(Math.max(0, Math.min(100, confidence)));
  }

  protected resultCountLabel(count: number): string {
    return this.translate.instant(count === 1 ? 'translator.results.one' : 'translator.results.other', { count });
  }

  protected serviceIcon(key: string): IconName {
    if (key === 'nlp') return 'activity';
    if (key === 'ontology') return 'network';
    return 'database';
  }

  protected sampleIcon(index: number): IconName {
    const icons: IconName[] = ['hospital', 'heart', 'stethoscope', 'pill', 'flask'];
    return icons[index] ?? 'sparkles';
  }

  protected pipelineStatusKind(state: PipelineStageState): 'success' | 'danger' | 'neutral' {
    if (state === 'complete') return 'success';
    return state === 'failed' ? 'danger' : 'neutral';
  }

  protected pipelineStages(answer: AskResult, question: string): PipelineStage[] {
    const trace = answer.parse.pipeline ?? [];
    const event = (step: string) => trace.find((item) => item.step === step);
    const detailFor = (item: typeof trace[number] | undefined, fallback: string): string =>
      item ? [item.tool, item.detail].filter(Boolean).join(' · ') : fallback;

    const language = event('language-detection');
    const tokenization = event('tokenization-lemmatization');
    const entityLinking = event('entity-linking');
    const intentClassification = event('intent-classification');
    const generation = event('sparql-generation');
    const execution = event('sparql-execution');
    const hasQuery = this.queryOf(answer).trim().length > 0;
    const refused = generation?.detail.toLocaleLowerCase().includes('refused') ?? false;
    const rdflibValidated = generation !== undefined
      && /rdflib/i.test(generation.tool)
      && /valid sparql syntax/i.test(generation.detail);
    const validationFailed = generation !== undefined
      && /invalid sparql syntax|validation failed/i.test(generation.detail);
    const intentNotRecognized = answer.parse.intent === 'not_understood';

    return [
      { id: 'input', icon: 'bot', label: 'translator.pipeline.stages.input', state: 'complete', detail: question },
      {
        id: 'spacy', icon: 'activity', label: 'translator.pipeline.stages.spacy',
        state: tokenization ? 'complete' : 'skipped',
        detail: detailFor(tokenization ?? language, this.translate.instant('translator.pipeline.noTrace')),
      },
      {
        id: 'intent-entities', icon: 'target', label: 'translator.pipeline.stages.recognition',
        state: intentNotRecognized ? 'failed' : intentClassification && entityLinking ? 'complete' : 'skipped',
        detail: [intentClassification, entityLinking].filter(Boolean).map((item) => `${item!.tool} · ${item!.detail}`).join(' · ')
          || this.translate.instant('translator.pipeline.noTrace'),
      },
      {
        id: 'sparql', icon: 'braces', label: 'translator.pipeline.stages.sparql',
        state: refused ? 'failed' : generation && hasQuery ? 'complete' : 'skipped',
        detail: detailFor(generation, this.translate.instant('translator.pipeline.noTrace')),
      },
      {
        id: 'rdflib', icon: 'shield', label: 'translator.pipeline.stages.rdflib',
        state: rdflibValidated ? 'complete' : validationFailed ? 'failed' : 'skipped',
        detail: rdflibValidated
          ? detailFor(generation, this.translate.instant('translator.pipeline.noValidation'))
          : validationFailed
            ? detailFor(generation, this.translate.instant('translator.pipeline.validationFailed'))
            : this.translate.instant('translator.pipeline.noValidation'),
      },
      {
        id: 'fuseki', icon: 'database', label: 'translator.pipeline.stages.fuseki',
        state: execution ? 'complete' : 'skipped',
        detail: detailFor(execution, this.translate.instant('translator.pipeline.noExecution')),
      },
      {
        id: 'results', icon: 'list-checks', label: 'translator.pipeline.stages.results',
        state: execution ? 'complete' : 'skipped',
        detail: execution
          ? this.translate.instant('translator.pipeline.resultCount', { count: answer.rows.length })
          : this.translate.instant('translator.pipeline.noResults'),
      },
    ];
  }

  protected assignmentIntent(parse: NlpParse): string {
    const direct: Record<string, string> = {
      disease_symptoms: 'FIND_SYMPTOMS',
      disease_treatments: 'FIND_TREATMENTS',
      disease_medications: 'FIND_TREATMENTS',
      doctors_by_specialty: 'FIND_DOCTORS',
      patient_doctor: 'FIND_DOCTORS',
      doctor_patients: 'FIND_DOCTORS',
      upcoming_appointments: 'FIND_APPOINTMENTS',
      patient_appointments: 'FIND_APPOINTMENTS',
      appointments_by_status: 'FIND_APPOINTMENTS',
    };
    if (direct[parse.intent]) return direct[parse.intent];
    if (parse.intent === 'list_instances') {
      const className = String(parse.slots['class'] ?? parse.filters['class'] ?? '');
      const listIntent: Record<string, string> = {
        Disease: 'LIST_DISEASES',
        Hospital: 'LIST_HOSPITALS',
        Doctor: 'LIST_DOCTORS',
        Patient: 'LIST_PATIENTS',
        Symptom: 'LIST_SYMPTOMS',
        Treatment: 'LIST_TREATMENTS',
        Medication: 'LIST_MEDICATIONS',
        MedicalAppointment: 'LIST_APPOINTMENTS',
        MedicalTest: 'LIST_TESTS',
      };
      return listIntent[className] ?? 'LIST_INSTANCES';
    }
    return parse.intent.toUpperCase();
  }

  protected confidenceKind(parse: NlpParse): 'success' | 'warning' | 'danger' {
    if (parse.confidence >= 0.8) return 'success';
    return parse.confidence >= 0.55 ? 'warning' : 'danger';
  }

  /** The explanation in the interface language, else the one the service chose. */
  protected explanationOf(parse: NlpParse): string {
    if (parse.language === 'ar' || parse.language === 'tn') return '';
    const local = parse.explanation[parse.language] ?? parse.explanation[this.lang()];
    if (local && local.length > 0) return local;
    const chosen = parse.explanation['chosen'];
    if (chosen && chosen.length > 0) return chosen;
    const english = parse.explanation['en'];
    return english ?? '';
  }

  /** The executed query when the store ran one, otherwise what the service wrote. */
  protected queryOf(answer: AskResult): string {
    return answer.sparql.length > 0 ? answer.sparql : answer.parse.sparql;
  }

  protected scoreOf(entity: NlpEntity): number | null {
    return entity.score > 0 ? Math.round(entity.score * 100) : null;
  }

  /**
   * A recognised term links to its record only when the route exists and the role
   * may read that entity: a patient answer never links out of the portal.
   */
  protected entityHref(entity: NlpEntity, answer: AskResult): string | null {
    if (this.portal) return null;
    if (entity.id.length === 0) return null;
    const key = this.entityKey(entity, answer);
    if (key === null || !this.auth.can(key, 'read')) return null;
    return entity.type === 'individual' ? `/records/${key}/${entity.id}` : `/records/${key}`;
  }

  protected resultIcon(parse: NlpParse): IconName {
    const intent = this.assignmentIntent(parse);
    if (intent.includes('HOSPITAL')) return 'hospital';
    if (intent.includes('APPOINTMENT')) return 'calendar-check';
    if (intent.includes('TEST') || intent.includes('EXAM')) return 'flask';
    if (intent.includes('TREATMENT') || intent.includes('MEDICATION')) return 'pill';
    if (intent.includes('DISEASE') || intent.includes('SYMPTOM')) return 'heart';
    if (intent.includes('DOCTOR')) return 'stethoscope';
    return 'database';
  }

  protected fieldIcon(field: string): IconName {
    const normalized = field.toLocaleLowerCase();
    if (/duration|period|days|years|time/.test(normalized)) return 'clock';
    if (/doctor|physician|specialist/.test(normalized)) return 'stethoscope';
    if (/hospital|clinic/.test(normalized)) return 'hospital';
    if (/disease|symptom|condition/.test(normalized)) return 'heart';
    if (/treatment|medication|medicine|drug/.test(normalized)) return 'pill';
    if (/test|exam|examination|diagnostic/.test(normalized)) return 'flask';
    if (/appointment|date/.test(normalized)) return 'calendar-check';
    return 'file-text';
  }

  protected rowTitle(answer: AskResult, row: Record<string, string>): string {
    const field = this.titleField(answer);
    const value = field ? this.readable(row[field] ?? '') : '';
    return value || this.translate.instant('translator.results.unnamed');
  }

  protected rowDetails(answer: AskResult, row: Record<string, string>): { key: string; label: string; value: string }[] {
    const titleField = this.titleField(answer);
    return answer.columns
      .filter((field) => field !== titleField)
      .map((field) => ({ key: field, label: this.fieldLabel(field), value: this.readable(row[field] ?? '') }))
      .filter((item) => item.value.length > 0);
  }

  protected fieldLabel(field: string): string {
    const label = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return label.length > 0 ? label.charAt(0).toLocaleUpperCase() + label.slice(1) : field;
  }

  private titleField(answer: AskResult): string | undefined {
    return answer.columns.find((field) =>
      /name|label|title|display|disease|symptom|treatment|medication|doctor|hospital|appointment|department|patient|test/i.test(field),
    ) ?? answer.columns[0];
  }

  protected exportCsv(answer: AskResult): void {
    if (answer.rows.length === 0) return;
    downloadCsv(`medicare-${answer.parse.intent}`, answer.columns, answer.rows);
  }

  protected scores(parse: NlpParse): ScoreRow[] {
    return Object.entries(parse.classifierScores)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({
        name,
        value: percent(value * 100, 1),
        width: `${Math.min(100, Math.max(0, value * 100)).toFixed(0)}%`,
      }));
  }

  protected timeOf(turn: ChatTurn): string {
    return formatDateTime(turn.sentAt, this.lang());
  }

  protected toggleVoice(): void {
    if (this.listening()) {
      this.stopVoice();
      return;
    }
    const Constructor = speechConstructor();
    if (Constructor === null) return;
    const recognition = new Constructor();
    recognition.lang = this.lang() === 'fr' ? 'fr-FR' : 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => this.hearResult(event);
    recognition.onerror = (event) => {
      this.listening.set(false);
      this.toast.error(this.translate.instant('chat.voice.failed'), event.error);
    };
    recognition.onend = () => {
      this.listening.set(false);
      this.recognition = null;
    };
    this.recognition = recognition;
    try {
      recognition.start();
      this.listening.set(true);
    } catch {
      this.clearRecognition();
      this.toast.error(this.translate.instant('chat.voice.failed'));
    }
  }

  private hearResult(event: SpeechEvent): void {
    let heard = '';
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results.item(index);
      if (result.isFinal && result.length > 0) heard += `${result.item(0).transcript} `;
    }
    const text = heard.trim();
    if (text.length === 0) return;
    this.draft.update((current) => (current.trim().length === 0 ? text : `${current.trim()} ${text}`));
  }

  private stopVoice(): void {
    if (this.recognition === null) {
      this.listening.set(false);
      return;
    }
    this.recognition.stop();
    this.clearRecognition();
  }

  private clearRecognition(): void {
    const recognition = this.recognition;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    }
    this.recognition = null;
    this.listening.set(false);
  }

  /** Keep only the most recent translation visible. */
  private commit(next: ChatTurn[]): void {
    this.turns.set(next.slice(-1));
  }

  private settle(id: string, answer: AskResult | null, error: string | null): void {
    const question = this.turns().find((turn) => turn.id === id)?.question;
    this.commit(
      this.turns().map((turn) => (turn.id === id ? { ...turn, pending: false, answer, error } : turn)),
    );
    if (question && answer) {
      const intent = this.assignmentIntent(answer.parse);
      this.recentSearches.update((items) =>
        items.map((item) => item.question === question ? { ...item, intent } : item),
      );
    }
    this.scrollToEnd();
  }

  private friendlyError(failure: unknown): string {
    const response = failure instanceof HttpErrorResponse ? failure : null;
    const status = response?.status ?? 0;
    if (status === 429) return this.translate.instant('errors.RATE_LIMITED');
    if ([502, 503, 504].includes(status)) return this.translate.instant('translator.error.serviceUnavailable');
    if (status === 403) return this.translate.instant('errors.FORBIDDEN');
    if (status === 0) return this.translate.instant('errors.OFFLINE');
    return this.translate.instant('translator.error.generic');
  }

  private entityKey(entity: NlpEntity, answer: AskResult): EntityKey | null {
    if (entity.type === 'class') return RECORD_ENTITY_BY_CLASS[entity.id] ?? null;
    if (entity.type !== 'individual') return null;
    for (const [slot, value] of Object.entries(answer.parse.slots)) {
      if (String(value ?? '') !== entity.id) continue;
      const key = RECORD_ENTITY_BY_SLOT[slot];
      if (key) return key;
    }
    return RECORD_ENTITY_BY_PREFIX[entity.id.split('_')[0]] ?? null;
  }

  private readable(value: string): string {
    const text = value.trim();
    if (text === 'true') return this.translate.instant('uipage.yes');
    if (text === 'false') return this.translate.instant('uipage.no');
    const bare = text.replace(/^<|>$/g, '');
    if (bare.startsWith('http://') || bare.startsWith('https://')) {
      const localName = bare.slice(Math.max(bare.lastIndexOf('#'), bare.lastIndexOf('/')) + 1);
      try {
        return decodeURIComponent(localName.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
      } catch {
        return localName.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
      }
    }
    if (bare.startsWith('urn:')) {
      return bare.slice(bare.lastIndexOf(':') + 1).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    }
    return bare.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

   private scrollToEnd(): void {
    setTimeout(() => {
      const host = this.thread();
      if (host) host.scrollTop = host.scrollHeight;
    });
  }
}
