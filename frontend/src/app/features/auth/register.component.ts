import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl, type ValidationErrors, type ValidatorFn } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { merge } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { UiAlertComponent } from '../../shared/ui/alert/ui-alert.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiDateInputComponent } from '../../shared/ui/date/ui-date-input.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiInputComponent } from '../../shared/ui/input/ui-input.component';
import { UiSelectComponent, type SelectOption } from '../../shared/ui/select/ui-select.component';
import { AccountService } from '../../core/api/account.service';
import { problemOf } from '../../core/api/error.interceptor';
import type { RegisterInput } from '../../core/api/models';
import { toDateInput } from '../../core/util/format';

/** The policy the REST register endpoint enforces: 8 characters, a letter, a digit. */
const passwordPolicy: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return /[A-Za-z]/.test(value) && /\d/.test(value) ? null : { password: true };
};

/** Reported on the confirmation control so the field itself carries the message. */
const matchesPassword: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  const password: unknown = control.parent?.get('password')?.value;
  return password === value ? null : { passwordMismatch: true };
};

interface AlertState {
  readonly kind: 'danger';
  readonly titleKey: string;
  readonly hintKey: string | null;
}

/**
 * Patient self-registration: it creates the login and the linked `Patient`
 * individual in one call, so the field rules mirror the back-end contract
 * exactly (409 for an existing address, 400 with the list of violations).
 */
@Component({
  selector: 'page-register',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslateModule,
    UiAlertComponent,
    UiButtonComponent,
    UiCardComponent,
    UiDateInputComponent,
    UiIconComponent,
    UiInputComponent,
    UiSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <section class="hero">
        <div class="hero__inner">
          <div class="hero__visual" aria-hidden="true">
            <svg viewBox="0 0 560 560" role="presentation">
              <defs>
                <linearGradient id="auth-tube-gradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="#50d6d0" />
                  <stop offset="1" stop-color="#4d7cff" />
                </linearGradient>
                <radialGradient id="auth-glow-gradient">
                  <stop offset="0" stop-color="#284d83" stop-opacity=".72" />
                  <stop offset="1" stop-color="#0a1426" stop-opacity="0" />
                </radialGradient>
              </defs>
              <circle class="hero__glow" cx="280" cy="280" r="248" fill="url(#auth-glow-gradient)" />
              <circle class="hero__halo" cx="280" cy="280" r="186" fill="#122440" opacity=".68" />
              <circle cx="280" cy="280" r="144" fill="none" stroke="#35547e" stroke-width="1.5" opacity=".45" />
              <g fill="none" stroke="#4b6a99" stroke-width="2" opacity=".22">
                <circle cx="112" cy="164" r="24" /><path d="M112 151v26M99 164h26" />
                <circle cx="444" cy="354" r="18" /><path d="M444 344v20M434 354h20" />
                <circle cx="405" cy="126" r="9" /><circle cx="151" cy="402" r="8" />
              </g>
              <rect x="166" y="198" width="228" height="154" rx="28" fill="#101d32" stroke="#294567" stroke-width="2" />
              <path class="hero__heartbeat" d="M192 278h38l22-38 30 76 27-53 20 18h39" fill="none" stroke="#63d9d0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M188 134v112c0 74 41 128 92 128s92-54 92-128V134" fill="none" stroke="#eef5ff" stroke-width="13" stroke-linecap="round" />
              <path d="M188 134v112c0 74 41 128 92 128s92-54 92-128V134" fill="none" stroke="url(#auth-tube-gradient)" stroke-width="7" stroke-linecap="round" />
              <path d="M174 112v32M202 112v32M358 112v32M386 112v32" stroke="#eef5ff" stroke-width="8" stroke-linecap="round" />
              <path d="M372 246v74c0 36-30 59-67 59h-25v39" fill="none" stroke="url(#auth-tube-gradient)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
              <circle cx="280" cy="438" r="31" fill="#0c192b" stroke="#eef5ff" stroke-width="9" />
              <circle cx="280" cy="438" r="15" fill="#18345a" stroke="#54d2d1" stroke-width="5" />
              <path class="hero__check" d="M428 190l7 7 14-16" fill="none" stroke="#65d9cc" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
        </div>
      </section>

      <svg class="auth-divider" viewBox="0 0 100 1000" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="auth-divider-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#5ce0d1" />
            <stop offset="52%" stop-color="#79c9f5" />
            <stop offset="100%" stop-color="#5277ff" />
          </linearGradient>
        </defs>
        <path class="auth-divider__glow" d="M50 0 C18 80 82 120 50 200 C18 280 82 320 50 400 C18 480 82 520 50 600 C18 680 82 720 50 800 C18 880 82 920 50 1000" />
        <path class="auth-divider__line" d="M50 0 C18 80 82 120 50 200 C18 280 82 320 50 400 C18 480 82 520 50 600 C18 680 82 720 50 800 C18 880 82 920 50 1000" />
        <path class="auth-divider__flow" d="M50 0 C18 80 82 120 50 200 C18 280 82 320 50 400 C18 480 82 520 50 600 C18 680 82 720 50 800 C18 880 82 920 50 1000" />
      </svg>

      <main class="panel">
        <header class="auth-brand">
          <h1 class="auth-brand__title">
            <span class="auth-brand__mark"><ui-icon name="heart" size="22" /></span>
            <span>{{ "common.appName" | translate }}</span>
          </h1>
          <p class="auth-brand__tagline">{{ "common.tagline" | translate }}</p>
        </header>

        @if (registered()) {
          <ui-card class="card" icon="circle-check" pad="md" elevated>
            <div class="stack">
              <ui-alert kind="success" [title]="'auth.register.successTitle' | translate">
                {{ 'auth.register.successText' | translate }}
              </ui-alert>
              <ui-button icon="log-in" (click)="goLogin()">{{ 'auth.register.loginLink' | translate }}</ui-button>
            </div>
          </ui-card>
        } @else {
          <ui-card
            class="card"
            icon="user"
            pad="md"
            elevated
            [title]="'auth.register.title' | translate"
          >
            <form
              class="stack"
              [formGroup]="form"
              (ngSubmit)="submit()"
              [attr.aria-label]="'auth.register.title' | translate"
              novalidate
            >
              @if (alert(); as state) {
                <ui-alert [kind]="state.kind" [title]="state.titleKey | translate">
                  @if (violations().length > 0) {
                    <p class="violations__title">{{ 'auth.register.violationsTitle' | translate }}</p>
                    <ul class="violations">
                      @for (violation of violations(); track violation) {
                        <li>{{ violation }}</li>
                      }
                    </ul>
                  }
                  @if (state.hintKey !== null) {
                    <p>{{ state.hintKey | translate }}</p>
                  }
                </ui-alert>
              }

              <p class="role-note">{{ 'auth.register.patientRoleNotice' | translate }}</p>

              <div class="grid">
                <ui-input
                  formControlName="fullName"
                  icon="user"
                  [required]="true"
                  [disabled]="pending()"
                  label="auth.register.fullName"
                />
                <ui-input
                  formControlName="email"
                  type="email"
                  icon="mail"
                  autocomplete="email"
                  [required]="true"
                  [disabled]="pending()"
                  label="auth.register.email"
                  placeholder="auth.login.emailPlaceholder"
                />
                <ui-input
                  formControlName="password"
                  type="password"
                  icon="shield"
                  autocomplete="new-password"
                  [required]="true"
                  [disabled]="pending()"
                  hint="auth.register.passwordHint"
                  label="auth.register.password"
                />
                <ui-input
                  formControlName="confirm"
                  type="password"
                  icon="shield"
                  autocomplete="new-password"
                  [required]="true"
                  [disabled]="pending()"
                  [errors]="confirmErrors()"
                  label="auth.register.confirm"
                />
                <ui-date-input
                  formControlName="birthDate"
                  [required]="true"
                  [disabled]="pending()"
                  [max]="maxBirthDate"
                  label="auth.register.birthDate"
                />
                <ui-select
                  formControlName="gender"
                  [options]="genderOptions"
                  [disabled]="pending()"
                  hint="common.optional"
                  label="auth.register.gender"
                />
                <ui-input
                  formControlName="phone"
                  type="tel"
                  icon="phone"
                  autocomplete="tel"
                  [disabled]="pending()"
                  hint="common.optional"
                  label="auth.register.phone"
                />
                <ui-input
                  formControlName="address"
                  icon="map-pin"
                  autocomplete="street-address"
                  [disabled]="pending()"
                  hint="common.optional"
                  label="auth.register.address"
                />
              </div>

              <ui-button type="submit" icon="plus" [loading]="pending()" [disabled]="pending()" [fullWidth]="true">
                {{ 'auth.register.submit' | translate }}
              </ui-button>

              <p class="signup">
                <span>{{ 'auth.register.haveAccount' | translate }}</span>
                <a routerLink="/login">{{ 'auth.register.loginLink' | translate }}</a>
              </p>
            </form>
          </ui-card>
        }
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--bg);
        color: var(--text);
      }
      .auth {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-height: 100dvh;
      }
      .hero {
        background: var(--gradient-hero);
        border-block-end: 1px solid var(--border);
        padding: var(--sp-5) var(--sp-4);
      }
      .hero__inner {
        max-width: 560px;
        margin-inline: auto;
      }
      .hero__brand {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        margin: 0;
        font-size: var(--fs-xl);
        font-weight: 700;
        color: var(--primary);
      }
      .hero__tagline {
        margin: var(--sp-2) 0 0;
        font-size: var(--fs-base);
        font-weight: 600;
      }
      .hero__lead {
        margin: var(--sp-3) 0 0;
        font-size: var(--fs-sm);
        line-height: 1.6;
        color: var(--text-muted);
      }
      .hero__points {
        list-style: none;
        margin: var(--sp-4) 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
      }
      .hero__points li {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        font-size: var(--fs-sm);
        color: var(--text);
      }
      .hero__points ui-icon {
        color: var(--secondary);
        flex: none;
        margin-top: 2px;
      }
      .hero__note {
        margin: var(--sp-4) 0 0;
        font-size: var(--fs-xs);
        color: var(--text-subtle);
      }
      .panel {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: var(--sp-5) var(--sp-3) var(--sp-6);
      }
      .card {
        width: 100%;
        max-width: 560px;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
      }
      .role-note {
        margin: 0;
        padding: var(--sp-2) var(--sp-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface-alt);
        color: var(--text-muted);
        font-size: var(--fs-sm);
      }
      .grid {
        display: grid;
        gap: var(--sp-3);
        width: 100%;
        min-width: 0;
        grid-template-columns: minmax(0, 1fr);
      }
      .grid > * { min-width: 0; max-width: 100%; }
      .signup {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--text-muted);
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
      .violations {
        margin: var(--sp-2) 0 0;
        padding-inline-start: var(--sp-5);
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        font-size: var(--fs-sm);
      }
      .violations__title {
        margin: 0;
        font-weight: 600;
        font-size: var(--fs-sm);
      }
      .grid { grid-template-columns: minmax(0, 1fr); }
      @media (min-width: 760px) {
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (min-width: 1025px) {
        .auth {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: stretch;
        }
        .hero {
          border-block-end: 0;
          border-inline-end: 1px solid var(--border);
          display: flex;
          align-items: center;
          padding: var(--sp-7) var(--sp-6);
        }
        .hero__inner {
          max-width: 480px;
        }
        .hero__brand {
          font-size: var(--fs-2xl);
        }
        .hero__lead {
          font-size: var(--fs-base);
        }
        .panel {
          align-items: center;
        }
      }

      .hero { position: relative; overflow: hidden; isolation: isolate; }
      .hero::before {
        content: '';
        position: absolute;
        width: 24rem;
        height: 24rem;
        inset: auto -8rem -12rem auto;
        border-radius: 50%;
        background: rgb(255 255 255 / 12%);
        pointer-events: none;
        z-index: -1;
      }
      .hero__inner { position: relative; z-index: 1; width: min(100%, 520px); }
      .hero__brand { gap: var(--sp-3); font-size: clamp(1.7rem, 3vw, 2.35rem); letter-spacing: -0.045em; }
      .hero__mark {
        display: grid;
        place-items: center;
        width: 3.25rem;
        height: 3.25rem;
        border-radius: 1.05rem;
        background: var(--primary);
        color: #fff;
        box-shadow: 0 12px 28px rgb(41 59 125 / 24%);
      }
      .hero__tagline {
        max-width: 25ch;
        margin-top: var(--sp-3);
        font-size: clamp(1.2rem, 2.2vw, 1.65rem);
        line-height: 1.25;
        letter-spacing: -0.025em;
      }
      .hero__visual {
        width: min(100%, 520px);
        margin: clamp(1.5rem, 4vh, 2.75rem) auto 0;
        animation: auth-float 7s ease-in-out infinite;
      }
      .hero__visual svg { display: block; width: 100%; height: auto; overflow: visible; }
      .auth { animation: auth-appear 420ms cubic-bezier(.2,.75,.3,1) both; }
      @keyframes auth-appear {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes auth-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-7px); }
      }
      @media (max-width: 1024px) {
        .hero__inner { display: flex; flex-wrap: wrap; align-items: center; column-gap: var(--sp-4); }
        .hero__tagline { flex: 1 1 15rem; margin-top: 0; }
        .hero__visual { flex: 0 1 220px; margin: var(--sp-2) auto 0; }
      }
      @media (max-width: 600px) { .hero__visual { display: none; } }
      @media (prefers-reduced-motion: reduce) { .auth { animation: none !important; } }
      :host { position: fixed; inset: 0; display: block; width: 100%; max-width: 100vw; height: 100dvh; min-height: 100dvh; padding: 0; overflow: hidden; box-sizing: border-box; background: #07111f; }
      .auth {
        position: relative;
        width: 100%;
        max-width: 100vw;
        height: 100%;
        min-height: 0;
        margin: 0;
        box-sizing: border-box;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        align-items: stretch;
        overflow: hidden;
        background: #f8f9fc;
      }
      .panel {
        order: 1;
        min-width: 0;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 0;
        padding: clamp(12px, 2vh, 20px) clamp(20px, 4vw, 68px);
        background: linear-gradient(145deg, #fff 0%, #f8f9fd 66%, #edf1fb 100%);
      }
      .auth-brand { width: 100%; max-width: 520px; margin: 0 auto 10px; }
      .auth-brand__title {
        display: flex; align-items: center; gap: 12px; margin: 0;
        color: #294ec0; font-size: clamp(1.65rem, 2.4vw, 2.15rem);
        font-weight: 750; letter-spacing: -.045em; line-height: 1.1;
      }
      .auth-brand__mark {
        display: grid; width: 46px; height: 46px; place-items: center; flex: none;
        border-radius: 15px; background: #4364d3; color: white;
        box-shadow: 0 10px 24px rgb(47 73 160 / 20%);
      }
      .auth-brand__tagline { margin: 5px 0 0 58px; color: #59657a; font-size: var(--fs-sm); line-height: 1.4; }
      .card { width: 100%; max-width: min(520px, 100%); min-width: 0; }
      .stack { width: 100%; max-width: 100%; min-width: 0; }
      .stack > *, .grid > * { min-width: 0; max-width: 100%; }
      .panel ui-card.card { position: relative; z-index: 1; overflow: visible; border: 0; background: transparent; box-shadow: none; --sp-3: 10px; --sp-4: 12px; --sp-5: 16px; --control-padding-block: 6px; }
      .hero {
        order: 2; display: grid; min-width: 0; place-items: center;
        padding: clamp(28px, 4vw, 60px); border: 0;
        background:
          radial-gradient(circle at 18% 22%, rgb(42 80 140 / 35%), transparent 34%),
          radial-gradient(circle at 82% 78%, rgb(34 58 108 / 48%), transparent 36%),
          radial-gradient(rgb(87 117 164 / 15%) .8px, transparent .8px) 0 0 / 26px 26px,
          linear-gradient(145deg, #101b30, #080f1d 72%);
      }
      .hero::before {
        inset: 7% auto auto 8%; width: min(70%, 26rem); height: min(70%, 26rem);
        border: 1px solid rgb(151 180 222 / 10%);
        background: radial-gradient(circle, rgb(73 109 169 / 12%), transparent 68%); z-index: 0;
      }
      .hero__inner { width: min(100%, 560px); max-width: 560px; margin: 0 auto; }
      .hero__visual { width: 100%; max-width: 560px; margin: 0 auto; filter: drop-shadow(0 24px 42px rgb(0 0 0 / 22%)); }
      .hero__visual svg { display: block; width: 100%; height: auto; }
      .hero__visual { animation: auth-illustration-float 6s ease-in-out infinite; will-change: transform; }
      .hero__visual svg .hero__glow, .hero__visual svg .hero__halo, .hero__visual svg .hero__check {
        transform-box: fill-box;
        transform-origin: center;
      }
      .hero__visual svg .hero__glow { animation: auth-glow-breathe 5s ease-in-out infinite; }
      .hero__visual svg .hero__halo { animation: auth-halo-pulse 5s ease-in-out infinite; }
      .hero__visual svg .hero__heartbeat { animation: auth-heartbeat-glow 3.2s ease-in-out infinite; }
      .hero__visual svg .hero__check { animation: auth-check-pop 4s ease-in-out infinite; }
      @keyframes auth-illustration-float {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-11px) rotate(-.6deg); }
      }
      @keyframes auth-glow-breathe {
        0%, 100% { opacity: .78; transform: scale(.98); }
        50% { opacity: 1; transform: scale(1.035); }
      }
      @keyframes auth-halo-pulse {
        0%, 100% { opacity: .62; transform: scale(.99); }
        50% { opacity: .82; transform: scale(1.02); }
      }
      @keyframes auth-heartbeat-glow {
        0%, 100% { opacity: .9; filter: drop-shadow(0 0 0 rgb(99 217 208 / 0%)); }
        50% { opacity: 1; filter: drop-shadow(0 0 7px rgb(99 217 208 / 42%)); }
      }
      @keyframes auth-check-pop {
        0%, 82%, 100% { opacity: .78; transform: scale(1); }
        88% { opacity: 1; transform: scale(1.18); }
      }
      /* the hero illustration keeps drifting slowly even when motion is reduced, so it never looks frozen */
      @media (prefers-reduced-motion: reduce) {
        .hero__visual { animation: auth-illustration-float 12s ease-in-out infinite !important; }
        .hero__glow, .hero__halo, .hero__heartbeat, .hero__check { animation: none !important; }
      }
      @media (min-width: 1025px) {
        .hero { order: 1; }
        .panel { order: 2; }
      }
      @media (min-width: 1025px) and (min-height: 850px) {
        .panel { padding-block: 10px; }
      }
      .auth { isolation: isolate; border: 1px solid rgb(225 235 255 / 38%); border-radius: 24px; }
      .auth::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 6;
        padding: 1.5px;
        border-radius: inherit;
        background: linear-gradient(120deg, #66ded1 0%, #b5cdf8 24%, #627aff 50%, #64d8d1 76%, #66ded1 100%);
        background-size: 220% 220%;
        pointer-events: none;
        opacity: .72;
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        animation: auth-frame-shimmer 8s ease-in-out infinite;
      }
      @keyframes auth-frame-shimmer {
        0%, 100% { background-position: 0% 50%; opacity: .58; }
        50% { background-position: 100% 50%; opacity: 1; filter: drop-shadow(0 0 8px rgb(91 220 212 / 38%)); }
      }
      @media (prefers-reduced-motion: reduce) { .auth::before { animation: none !important; } }
      .auth-divider {
        position: absolute;
        z-index: 4;
        inset-block: 0;
        left: 50%;
        width: clamp(76px, 7vw, 112px);
        height: 100%;
        overflow: visible;
        pointer-events: none;
        filter: drop-shadow(0 0 10px rgb(76 211 209 / 28%));
        animation: auth-divider-sway 7s ease-in-out infinite;
      }
      /* the dark hero is the left column here, so the wave sits inside it */
      @media (min-width: 1025px) { .auth-divider { left: calc(50% - 72px); } }
      .auth-divider__glow, .auth-divider__line, .auth-divider__flow { fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .auth-divider__glow { stroke: #55d5d0; stroke-width: 18; opacity: .18; }
      .auth-divider__line { stroke: url(#auth-divider-gradient); stroke-width: 4; opacity: .94; }
      .auth-divider__flow { stroke: #e8ffff; stroke-width: 2; stroke-dasharray: 5 30; animation: auth-divider-flow 3.4s linear infinite; }
      @keyframes auth-divider-sway {
        0%, 100% { transform: translateX(calc(-50% - 6px)); }
        50% { transform: translateX(calc(-50% + 7px)); }
      }
      @keyframes auth-divider-flow { to { stroke-dashoffset: -70; } }
      @media (max-width: 1024px) { .auth-divider { display: none; } }
      @media (prefers-reduced-motion: reduce) { .auth-divider, .auth-divider__flow { animation: none !important; } }
      @media (max-width: 1024px) {
        .auth { width: 100%; height: 100%; min-height: 0; margin: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); overflow: hidden; }
        .hero { display: none; }
        .panel {
          order: 1;
          min-height: 0;
          align-items: center;
          justify-content: flex-start;
          padding: clamp(12px, 1.8vh, 20px) clamp(20px, 4vw, 52px);
        }
        .stack { gap: 8px; }
        .grid { gap: 8px 14px; }
        .auth-brand { margin-bottom: 8px; }
        .auth-brand__mark { width: 40px; height: 40px; border-radius: 13px; }
        .auth-brand__tagline { margin-top: 3px; }
      }
      @media (max-width: 600px) {
        .auth { width: 100%; margin: 0; }
        .panel { padding: 24px 18px 28px; }
        .auth-brand__tagline { margin-inline-start: 0; }
        .hero { display: none; }
      }
    `,
  ],
})
export class RegisterComponent implements OnInit {
  private readonly accounts = inject(AccountService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = inject(FormBuilder).group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(160)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(160)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(200), passwordPolicy]],
    confirm: ['', [Validators.required, matchesPassword]],
    birthDate: ['', [Validators.required]],
    gender: [''],
    phone: ['', [Validators.pattern('^[0-9+ ]{6,20}$'), Validators.maxLength(20)]],
    address: ['', [Validators.maxLength(200)]],
  });

  readonly genderOptions: SelectOption[] = [
    { value: 'Male', label: 'auth.register.genderMale' },
    { value: 'Female', label: 'auth.register.genderFemale' },
  ];

  /** A birth date in the future is refused by the age derivation, so cap it. */
  readonly maxBirthDate = toDateInput(new Date().toISOString());

  readonly pending = signal(false);
  readonly registered = signal(false);
  readonly alert = signal<AlertState | null>(null);
  readonly violations = signal<string[]>([]);
  readonly confirmErrors = signal<string[] | null>(null);

  /** The confirmation message is re-read whenever either password changes. */
  ngOnInit(): void {
    merge(this.form.controls.password.events, this.form.controls.confirm.events)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshConfirmErrors());
  }

  protected submit(): void {
    if (this.pending() || this.registered()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.refreshConfirmErrors();
      return;
    }
    const raw = this.form.getRawValue();
    const input: RegisterInput = {
      fullName: (raw['fullName'] ?? '').trim(),
      email: (raw['email'] ?? '').trim(),
      password: raw['password'] ?? '',
      birthDate: raw['birthDate'] ?? undefined,
      gender: raw['gender'] ?? undefined,
      phone: (raw['phone'] ?? '').trim() || undefined,
      address: (raw['address'] ?? '').trim() || undefined,
    };
    this.alert.set(null);
    this.violations.set([]);
    this.pending.set(true);
    this.accounts.register(input).subscribe({
      next: () => {
        this.pending.set(false);
        this.registered.set(true);
      },
      error: (error: HttpErrorResponse) => {
        this.pending.set(false);
        this.report(error);
      },
    });
  }

  /** No auto-login: the confirmation only points at the sign-in page. */
  protected goLogin(): void {
    void this.router.navigateByUrl('/login');
  }

  private report(error: HttpErrorResponse): void {
    const problem = problemOf(error);
    const details = problem?.details?.violations;
    if (error.status === 409) {
      this.alert.set({ kind: 'danger', titleKey: 'errors.CONFLICT', hintKey: 'auth.register.conflictHint' });
      return;
    }
    if (error.status === 400 && Array.isArray(details) && details.length > 0) {
      this.violations.set(details.map((violation: string) => String(violation)));
      this.alert.set({ kind: 'danger', titleKey: 'errors.VALIDATION_ERROR', hintKey: null });
      return;
    }
    if (error.status === 429) {
      this.alert.set({ kind: 'danger', titleKey: 'errors.RATE_LIMITED', hintKey: null });
      return;
    }
    if (error.status === 0) {
      this.alert.set({ kind: 'danger', titleKey: 'errors.OFFLINE', hintKey: null });
      return;
    }
    this.alert.set({ kind: 'danger', titleKey: 'errors.generic', hintKey: null });
  }

  private refreshConfirmErrors(): void {
    const control = this.form.controls.confirm;
    const show = (control.touched || control.dirty) && control.hasError('passwordMismatch');
    this.confirmErrors.set(show ? ['auth.register.mismatch'] : null);
  }
}

