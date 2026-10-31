import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import type { ApiProblem } from '../api/models';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  ms: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly translate = inject(TranslateService);
  private sequence = 0;
  private readonly items = signal<Toast[]>([]);

  readonly toasts = computed(() => this.items());

  show(kind: ToastKind, title: string, message?: string, ms = 5000): number {
    const id = ++this.sequence;
    this.items.update((list) => [...list, { id, kind, title, message, ms }]);
    if (ms > 0) setTimeout(() => this.dismiss(id), ms);
    return id;
  }

  success(title: string, message?: string): number {
    return this.show('success', title, message);
  }

  error(title: string, message?: string): number {
    return this.show('error', title, message, 8000);
  }

  warning(title: string, message?: string): number {
    return this.show('warning', title, message, 7000);
  }

  info(title: string, message?: string): number {
    return this.show('info', title, message);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((toast) => toast.id !== id));
  }

  clear(): void {
    this.items.set([]);
  }

  /**
   * Turns a REST failure into a readable toast: the server message, plus the
   * axiom violations when the write was refused by the ontology.
   */
  fromProblem(error: HttpErrorResponse): void {
    const problem = error.error as ApiProblem | undefined;
    const key = problem?.code ? `errors.${problem.code}` : '';
    const translated = key ? this.translate.instant(key) : '';
    const title = translated && translated !== key ? translated : (problem?.message ?? this.serverMessage(error));
    const violations = problem?.details?.violations;
    const message = Array.isArray(violations) && violations.length > 0 ? violations.slice(0, 4).join('\n') : undefined;
    this.error(this.translate.instant('common.operationFailed'), `${title}${message ? `\n${message}` : ''}`);
  }

  private serverMessage(error: HttpErrorResponse): string {
    if (error.status === 0) return this.translate.instant('errors.OFFLINE');
    return error.statusText || this.translate.instant('errors.UNKNOWN');
  }
}
