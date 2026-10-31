import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiInputComponent } from '../../shared/ui/input/ui-input.component';
import { AccountService } from '../../core/api/account.service';

/**
 * Password recovery request. The API records the request and always answers the
 * same way, so the confirmation never reveals whether the address exists.
 */
@Component({
  selector: 'page-forgot-password',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslateModule,
    UiAlertComponent,
    UiButtonComponent,
    UiCardComponent,
    UiIconComponent,
    UiInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <div class="content">
        <h1 class="page__heading">{{ 'auth.forgot.title' | translate }}</h1>
        <ui-card
        class="card"
        icon="circle-help"
        pad="lg"
        elevated
        [subtitle]="'auth.forgot.subtitle' | translate"
      >
        @if (sent()) {
          <div class="stack">
            <ui-alert kind="info" [title]="'auth.forgot.sentTitle' | translate">
              <p>{{ 'auth.forgot.sentText' | translate }}</p>
              <p class="endpoint">
                <span class="endpoint__label">{{ 'auth.forgot.endpointLabel' | translate }}</span>
                <code class="font-mono">{{ 'auth.forgot.endpoint' | translate }}</code>
              </p>
            </ui-alert>
            <div class="actions">
              <ui-button variant="primary" icon="log-in" (click)="goLogin()">
                {{ 'auth.forgot.loginLink' | translate }}
              </ui-button>
              <ui-button variant="ghost" icon="refresh" (click)="reset()">
                {{ 'auth.forgot.again' | translate }}
              </ui-button>
            </div>
          </div>
        } @else {
          <form
            class="stack"
            [formGroup]="form"
            (ngSubmit)="submit()"
            [attr.aria-label]="'auth.forgot.title' | translate"
            novalidate
          >
            @if (errorKey(); as key) {
              <ui-alert kind="danger" [title]="key | translate" />
            }

            <ui-input
              formControlName="email"
              type="email"
              icon="mail"
              autocomplete="email"
              [autofocus]="true"
              [required]="true"
              [disabled]="pending()"
              label="auth.forgot.email"
              placeholder="auth.login.emailPlaceholder"
            />

            <ui-button type="submit" icon="send" [loading]="pending()" [disabled]="pending()" [fullWidth]="true">
              {{ 'auth.forgot.submit' | translate }}
            </ui-button>

            <p class="links">
              <a routerLink="/login">{{ 'auth.forgot.loginLink' | translate }}</a>
              <a routerLink="/register">{{ 'auth.login.registerLink' | translate }}</a>
            </p>
          </form>
        }
        </ui-card>
      </div>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--gradient-hero);
        color: var(--text);
      }
      .page {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100dvh;
        padding: var(--sp-5) var(--sp-3) var(--sp-6);
      }
      .content {
        width: 100%;
        max-width: 440px;
      }
      .page__heading {
        margin: 0 0 var(--sp-4);
        font-size: var(--fs-xl);
        font-weight: 700;
      }
      .card {
        width: 100%;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
      }
      .links {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--sp-2);
        margin: 0;
        font-size: var(--fs-sm);
      }
      .endpoint {
        margin: var(--sp-2) 0 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
        font-size: var(--fs-sm);
      }
      .endpoint__label {
        color: var(--text-muted);
      }
      code {
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: var(--radius-input);
        padding: 2px var(--sp-2);
        font-size: var(--fs-xs);
        overflow-wrap: anywhere;
      }
      a {
        color: var(--primary);
        text-decoration: none;
        border-radius: var(--radius-input);
      }
      a:hover {
        text-decoration: underline;
      }
      a:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
    `,
  ],
})
export class ForgotPasswordComponent {
  private readonly accounts = inject(AccountService);
  private readonly router = inject(Router);

  readonly form = inject(FormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });

  readonly pending = signal(false);
  readonly sent = signal(false);
  readonly errorKey = signal<string | null>(null);

  protected submit(): void {
    if (this.pending()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const email = (this.form.getRawValue()['email'] ?? '').trim();
    this.errorKey.set(null);
    this.pending.set(true);
    this.accounts.forgotPassword(email).subscribe({
      next: () => {
        this.pending.set(false);
        this.sent.set(true);
      },
      // an unknown address is answered like a known one, so 404 also confirms
      error: (error: HttpErrorResponse) => {
        this.pending.set(false);
        if (error.status === 404) {
          this.sent.set(true);
          return;
        }
        this.errorKey.set(error.status === 429 ? 'errors.RATE_LIMITED' : 'errors.generic');
      },
    });
  }

  protected reset(): void {
    this.sent.set(false);
    this.errorKey.set(null);
    this.form.reset();
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  protected goLogin(): void {
    void this.router.navigateByUrl('/login');
  }
}
