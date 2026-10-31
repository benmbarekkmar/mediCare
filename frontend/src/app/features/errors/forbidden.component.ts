import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { AuthService } from '../../core/auth/auth.service';

/**
 * 403. Reachable by an anonymous visitor too (a hand-typed url), so the sign-in
 * link is offered next to the two navigation actions.
 */
@Component({
  selector: 'page-forbidden',
  standalone: true,
  imports: [RouterLink, TranslateModule, UiButtonComponent, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <div class="panel" role="status">
        <span class="glyph" aria-hidden="true">
          <ui-icon name="shield" size="40" />
        </span>
        <h1 class="title">{{ 'errors.forbiddenTitle' | translate }}</h1>
        <p class="text">{{ 'errors.forbiddenText' | translate }}</p>
        <div class="actions">
          <ui-button icon="dashboard" (click)="goHome()">{{ 'auth.errorPages.goHome' | translate }}</ui-button>
          <ui-button variant="outline" icon="arrow-left" (click)="back()">
            {{ 'auth.errorPages.previous' | translate }}
          </ui-button>
        </div>
        @if (!signedIn) {
          <p class="hint">
            <a routerLink="/login">{{ 'common.signIn' | translate }}</a>
          </p>
        }
      </div>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--bg);
        color: var(--text);
      }
      .page {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100dvh;
        padding: var(--sp-5) var(--sp-4);
      }
      .panel {
        max-width: 520px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--sp-3);
      }
      .glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 72px;
        height: 72px;
        border-radius: var(--radius-pill);
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
        color: var(--warning-500);
      }
      .title {
        margin: 0;
        font-size: var(--fs-xl);
        font-weight: 700;
      }
      .text {
        margin: 0;
        font-size: var(--fs-base);
        line-height: 1.6;
        color: var(--text-muted);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--sp-2);
        margin-top: var(--sp-3);
      }
      .hint {
        margin: 0;
        font-size: var(--fs-sm);
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
export class ForbiddenComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  protected readonly signedIn = this.auth.isLoggedIn();

  protected goHome(): void {
    void this.router.navigateByUrl(this.homePath());
  }

  protected back(): void {
    this.location.back();
  }

  private homePath(): string {
    if (this.auth.hasRole('ADMIN')) return '/admin/dashboard';
    if (this.auth.hasRole('DOCTOR')) return '/doctor/dashboard';
    if (this.auth.hasRole('RECEPTIONIST')) return '/reception/dashboard';
    if (this.auth.hasRole('PATIENT')) return '/patient/dashboard';
    return '/login';
  }
}
