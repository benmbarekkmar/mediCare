import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AuthService } from '../core/auth/auth.service';
import { LangService } from '../core/i18n/i18n';
import { ThemeService } from '../core/theme/theme.service';
import { SearchService } from '../core/api/insight.service';
import type { SearchGroup } from '../core/api/models';
import { formatDateTime, statusClass } from '../core/util/format';
import { UiIconComponent } from '../shared/ui/icon/ui-icon.component';
import { CommandPaletteComponent } from './command-palette.component';
import { NotificationsService } from './notifications.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [RouterLink, TranslateModule, UiIconComponent, CommandPaletteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './topbar.component.html',
  styles: [`
    :host{display:block;min-width:0}.topbar{position:relative;z-index:var(--z-sticky);display:flex;align-items:center;gap:var(--sp-2);min-width:0;min-height:4rem;padding:var(--sp-2) var(--sp-4);background:var(--surface);border-bottom:1px solid var(--border)}
    .topbar__search{position:relative;display:flex;align-items:center;flex:1 1 18rem;min-width:5rem;max-width:42rem;height:2.5rem;padding-inline:var(--sp-3);gap:var(--sp-2);border:1px solid var(--border);border-radius:var(--radius-input);background:var(--surface-alt)}.topbar__search:focus-within{border-color:var(--primary);box-shadow:var(--focus-ring)}
    .topbar__search-icon{color:var(--text-subtle);flex:none}.topbar__search-input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font:inherit}.topbar__icon-btn,.topbar__text-btn,.topbar__user{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:2.5rem;min-height:2.5rem;padding:var(--sp-2);border:1px solid transparent;border-radius:var(--radius-input);background:transparent;color:var(--text-muted);cursor:pointer}
    .topbar__icon-btn:hover,.topbar__text-btn:hover,.topbar__user:hover{background:var(--bg-hover);color:var(--text)}.topbar__icon-btn:focus-visible,.topbar__text-btn:focus-visible,.topbar__user:focus-visible{outline:none;box-shadow:var(--focus-ring)}.topbar__badge{position:absolute;inset-block-start:1px;inset-inline-end:1px;min-width:1rem;padding:1px 4px;border-radius:var(--radius-pill);background:var(--danger-500);color:white;font-size:10px}
    .topbar__pop{position:relative;flex:none}.topbar__user{justify-content:flex-start;gap:var(--sp-2);max-width:13rem}.topbar__avatar{display:grid;place-items:center;width:1.75rem;height:1.75rem;flex:none;border-radius:var(--radius-pill);background:var(--primary-soft);color:var(--primary);font-weight:700}.topbar__user-name{max-width:8rem;font-size:var(--fs-sm);color:var(--text)}.topbar__identity{display:block;max-width:13rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm);font-weight:600;color:var(--text)}
    .topbar__panel{position:absolute;inset-block-start:calc(100% + var(--sp-2));inset-inline-start:0;z-index:var(--z-popover);width:min(26rem,calc(100vw - 1.5rem));max-height:min(70vh,32rem);overflow:auto;padding:var(--sp-2);border:1px solid var(--border);border-radius:var(--radius-card);background:var(--surface);box-shadow:var(--shadow-lg)}.topbar__panel--right{inset-inline-start:auto;inset-inline-end:0;width:min(22rem,calc(100vw - 1.5rem))}.topbar__group-title{margin:var(--sp-2);color:var(--text-subtle);font-size:var(--fs-xs);font-weight:700}
    .topbar__group-list,.topbar__alert-list{margin:0;padding:0;list-style:none}.topbar__hit,.topbar__alert,.topbar__menu-item{display:flex;width:100%;min-width:0;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);border:0;border-radius:var(--radius-input);background:transparent;color:var(--text);text-align:start;cursor:pointer}.topbar__hit{flex-direction:column;align-items:flex-start}.topbar__hit:hover,.topbar__alert:hover,.topbar__menu-item:hover{background:var(--bg-hover)}.topbar__hit-snippet,.topbar__empty,.topbar__user-email{color:var(--text-muted);font-size:var(--fs-xs)}.topbar__empty{margin:0;padding:var(--sp-3)}.topbar__alert{justify-content:space-between}.topbar__alert-meta{display:flex;flex:none;flex-direction:column;align-items:flex-end;font-size:var(--fs-xs)}.topbar__user-email{margin:var(--sp-2) var(--sp-3)}.topbar__menu-item--danger{color:var(--danger-600)}.topbar__spinner{width:1rem;height:1rem;flex:none;border:2px solid var(--border-strong);border-top-color:var(--primary);border-radius:50%;animation:topbar-spin 700ms linear infinite}.divider{border:0;border-top:1px solid var(--border);margin:var(--sp-1) 0}@keyframes topbar-spin{to{transform:rotate(360deg)}}
    @media(max-width:640px){.topbar{gap:var(--sp-1);padding-inline:var(--sp-2)}.topbar__search{flex-basis:4rem;padding-inline:var(--sp-2)}.topbar__palette{display:none}.topbar__identity{max-width:7rem;font-size:var(--fs-xs)}}
  `],
})
export class TopbarComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly langs = inject(LangService);
  private readonly translate = inject(TranslateService);
  private readonly search = inject(SearchService);
  readonly notifications = inject(NotificationsService);
  readonly toggleSidebar = output<void>();
  readonly openPalette = signal(false);
  private readonly searchInput = new Subject<string>();
  readonly term = signal('');
  readonly searching = signal(false);
  readonly groups = signal<SearchGroup[]>([]);
  readonly menu = signal<'none' | 'alerts' | 'language'>('none');
  readonly user = computed(() => this.auth.user());
  readonly themeIcon = computed(() => this.theme.resolved() === 'dark' ? 'sun' : 'moon');
  readonly langLabel = computed(() => this.langs.get() === 'en' ? 'FR' : 'EN');

  constructor() {
    this.searchInput.pipe(debounceTime(300), distinctUntilChanged()).subscribe((term) => this.runSearch(term));
    effect(() => { if (this.menu() === 'alerts') this.notifications.refresh(); });
  }

  onInput(value: string): void {
    this.term.set(value);
    if (value.trim().length < 2) { this.groups.set([]); this.searching.set(false); return; }
    this.searching.set(true);
    this.searchInput.next(value);
  }
  blurSearch(): void { setTimeout(() => { if (this.term().trim().length < 2) this.groups.set([]); }, 150); }
  @HostListener('document:click', ['$event'])
  dismiss(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (this.menu() !== 'none' && target && !target.closest('.topbar__pop')) this.menu.set('none');
  }
  closePanels(): void { this.groups.set([]); this.menu.set('none'); }
  toggleMenu(which: 'alerts' | 'language'): void { this.menu.update((current) => current === which ? 'none' : which); }
  showPalette(): void { this.openPalette.set(true); }
  go(href: string): void { this.closePanels(); void this.router.navigateByUrl(href); }
  resultHref(group: SearchGroup, id: string): string {
    const key = group.entity;
    return this.auth.role() === 'PATIENT' && ['patients', 'appointments', 'tests'].includes(key) ? '/patient/record' : `/records/${key}/${id}`;
  }
  switchLanguage(): void { this.langs.toggle(); this.menu.set('none'); }
  toggleTheme(): void { this.theme.toggle(); }
  protected when(appointment: { fields: Record<string, unknown> }): string {
    const date = appointment.fields['date'];
    return typeof date === 'string' ? formatDateTime(date, this.translate.currentLang ?? 'en') : '';
  }
  protected statusOf(status: unknown): string { return statusClass(status === null ? '' : String(status)); }
  protected trackGroup(_index: number, group: SearchGroup): string { return group.entity; }
  private runSearch(term: string): void {
    this.search.search(term, undefined, 4).subscribe({
      next: (result) => { this.groups.set(result.groups.filter((group) => group.items.length > 0)); this.searching.set(false); },
      error: () => this.searching.set(false),
    });
  }
}
