import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  model,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { SearchService } from '../core/api/insight.service';
import { AuthService } from '../core/auth/auth.service';
import type { SearchGroup, SearchHit } from '../core/api/models';
import { BACK_OFFICE_NAV, PORTAL_NAV, type NavItem } from './nav.config';
import { UiIconComponent } from '../shared/ui/icon/ui-icon.component';

interface Command {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: string;
}

/**
 * Ctrl+K palette: the same grouped `/search` endpoint as the top bar plus the
 * role's own navigation, so one keystroke reaches any screen or individual.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.scss'],
})
export class CommandPaletteComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly search = inject(SearchService);
  private readonly translate = inject(TranslateService);

  readonly open = model(false);
  private readonly keystrokes = new Subject<string>();
  readonly term = signal('');
  readonly groups = signal<SearchGroup[]>([]);
  readonly busy = signal(false);
  readonly index = signal(0);

  constructor() {
    this.keystrokes.pipe(debounceTime(250), distinctUntilChanged()).subscribe((term) => this.run(term));
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'k' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.open.set(true);
      return;
    }
    if (!this.open()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.choose(this.rows()[this.index()]);
    }
  }

  /** Commands and search hits share one flat list so arrow keys behave normally. */
  readonly rows = computed<Command[]>(() => {
    const term = this.term().trim();
    const nav = this.navCommands();
    const pages = term ? nav.filter((cmd) => this.matches(cmd, term)) : nav.slice(0, 6);
    const hits = this.groups().flatMap((group) => group.items.map((hit) => this.hitCommand(group, hit)));
    return [...hits, ...pages];
  });

  onInput(value: string): void {
    this.term.set(value);
    this.index.set(0);
    const term = value.trim();
    if (term.length < 2) {
      this.groups.set([]);
      this.busy.set(false);
      return;
    }
    this.busy.set(true);
    this.keystrokes.next(term);
  }

  choose(row: Command | undefined): void {
    if (!row) return;
    this.close();
    void this.router.navigateByUrl(row.href);
  }

  close(): void {
    this.open.set(false);
    this.term.set('');
    this.groups.set([]);
    this.index.set(0);
  }

  trackRow(_i: number, row: Command): string {
    return row.id;
  }

  private run(term: string): void {
    this.search.search(term, undefined, 4).subscribe({
      next: (result) => {
        this.groups.set(result.groups.filter((group) => group.items.length > 0));
        this.busy.set(false);
      },
      error: () => this.busy.set(false),
    });
  }

  private move(delta: number): void {
    const size = this.rows().length;
    if (size === 0) return;
    this.index.update((current) => (current + delta + size) % size);
  }

  private navCommands(): Command[] {
    const groups = this.auth.role() === 'PATIENT' ? [{ items: PORTAL_NAV }] : BACK_OFFICE_NAV[this.auth.role() ?? 'ADMIN'];
    const items: NavItem[] = groups.flatMap((group) => group.items);
    return items
      .filter((item) => !item.permission || this.auth.can(item.permission.entity, item.permission.action))
      .map((item) => ({
        id: `nav:${item.path}`,
        label: this.translate.instant(item.labelKey),
        hint: this.translate.instant('palette.page'),
        href: item.path,
        icon: item.icon,
      }));
  }

  private hitCommand(group: SearchGroup, hit: SearchHit): Command {
    const clinical = this.auth.role() === 'PATIENT';
    return {
      id: `hit:${group.entity}:${hit.id}`,
      label: hit.label,
      hint: group.label,
      href: clinical && ['patients', 'appointments', 'tests'].includes(group.entity) ? '/patient/record' : `/records/${group.entity}/${hit.id}`,
      icon: 'search',
    };
  }

  private matches(cmd: Command, term: string): boolean {
    return `${cmd.label} ${cmd.hint}`.toLowerCase().includes(term.toLowerCase());
  }
}
