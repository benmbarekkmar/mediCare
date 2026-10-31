import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiChipComponent } from '../../shared/ui/chip/ui-chip.component';
import type { IconName } from '../../shared/ui/icon/icons';

/**
 * The public face of the assistant. Understanding a question and running the
 * generated SPARQL touches patient data, so `/api/nlp/ask` sits behind
 * authentication; an anonymous visitor gets the pipeline explained, the exact
 * questions it answers, and a way in.
 */
@Component({
  selector: 'page-public-ask',
  standalone: true,
  imports: [RouterLink, TranslateModule, UiAlertComponent, UiButtonComponent, UiCardComponent, UiChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page ask">
      <header class="ask__head">
        <p class="ask__eyebrow">{{ 'assistant.eyebrow' | translate }}</p>
        <h1 class="ask__title">{{ 'assistant.title' | translate }}</h1>
        <p class="ask__lede">{{ 'assistant.publicLede' | translate }}</p>
      </header>

      <ui-alert kind="info" [title]="'assistant.signinTitle' | translate">
        <p class="ask__alert">{{ 'assistant.signinBody' | translate }}</p>
        <a routerLink="/login">{{ 'common.signIn' | translate }}</a>
      </ui-alert>

      <div class="ask__grid">
        @for (step of steps(); track step.icon) {
          <ui-card [title]="step.title" [subtitle]="step.body" [icon]="step.icon" elevated>
            <ol class="ask__examples">
              @for (example of step.examples; track example) {
                <li class="ask__example">{{ example }}</li>
              }
            </ol>
          </ui-card>
        }
      </div>

      <section class="ask__samples">
        <h2 class="ask__subtitle">{{ 'assistant.samplesTitle' | translate }}</h2>
        <p class="ask__sample-group">
          @for (question of enSamples(); track question) {
            <ui-chip [label]="question" />
          }
        </p>
        <p class="ask__sample-group">
          @for (question of frSamples(); track question) {
            <ui-chip [label]="question" />
          }
        </p>
        <div class="ask__cta">
          <ui-button [href]="'/login'" icon="log-in">{{ 'common.signIn' | translate }}</ui-button>
          <ui-button [href]="'/register'" variant="outline" icon="user">{{ 'nav.items.register' | translate }}</ui-button>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .ask {
        display: flex;
        flex-direction: column;
        gap: var(--sp-5);
      }
      .ask__eyebrow {
        margin: 0 0 var(--sp-2);
        color: var(--secondary);
        font-size: var(--fs-sm);
        font-weight: 650;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .ask__title {
        margin: 0;
        font-size: var(--fs-2xl);
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .ask__lede {
        max-width: 68ch;
        margin: var(--sp-2) 0 0;
        color: var(--text-muted);
        font-size: var(--fs-md);
      }
      .ask__grid {
        display: grid;
        gap: var(--sp-4);
        grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
      }
      .ask__subtitle {
        margin: 0 0 var(--sp-3);
        font-size: var(--fs-lg);
      }
      .ask__examples {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .ask__example,
      .ask__example li {
        font-size: var(--fs-sm);
      }
      .ask__example {
        padding: var(--sp-2) var(--sp-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
        background: var(--surface-alt);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .ask__sample-group {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
        margin: 0 0 var(--sp-3);
      }
      .ask__cta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-3);
        margin-top: var(--sp-4);
      }
    `,
  ],
})
export class PublicAskComponent {
  private readonly translate = inject(TranslateService);

  protected steps(): { icon: IconName; title: string; body: string; examples: string[] }[] {
    return [
      {
        icon: 'bot',
        title: this.translate.instant('assistant.stepAsk'),
        body: this.translate.instant('assistant.stepAskBody'),
        examples: this.list('assistant.examplesAsk'),
      },
      {
        icon: 'languages',
        title: this.translate.instant('assistant.stepMatch'),
        body: this.translate.instant('assistant.stepMatchBody'),
        examples: this.list('assistant.examplesMatch'),
      },
      {
        icon: 'database',
        title: this.translate.instant('assistant.stepQuery'),
        body: this.translate.instant('assistant.stepQueryBody'),
        examples: this.list('assistant.examplesQuery'),
      },
    ];
  }

  protected enSamples(): string[] {
    return this.list('assistant.samplesEn');
  }

  protected frSamples(): string[] {
    return this.list('assistant.samplesFr');
  }

  /** One translation key holds the sample questions as a `;`-separated line. */
  private list(key: string): string[] {
    return String(this.translate.instant(key))
      .split(';')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
