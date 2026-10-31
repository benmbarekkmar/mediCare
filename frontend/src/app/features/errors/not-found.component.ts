import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { AuthService } from '../../core/auth/auth.service';

/**
 * 404. It renders without a session and without a single HTTP call: the only
 * thing it needs to know is where the signed in account would have gone home.
 */
@Component({
  selector: 'page-not-found',
  standalone: true,
  imports: [TranslateModule, UiButtonComponent, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <div class="panel" role="status">
        <span class="glyph" aria-hidden="true">
          <ui-icon name="search" size="40" />
        </span>
        <h1 class="title">{{ 'errors.notFoundTitle' | translate }}</h1>
        <p class="text">{{ 'errors.notFoundText' | translate }}</p>
        <div class="actions">
          <ui-button icon="dashboard" (click)="goHome()">{{ 'auth.errorPages.goHome' | translate }}</ui-button>
          <ui-button variant="outline" icon="arrow-left" (click)="back()">
            {{ 'auth.errorPages.previous' | translate }}
          </ui-button>
        </div>
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
        color: var(--primary);
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
    `,
  ],
})
export class NotFoundComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

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
