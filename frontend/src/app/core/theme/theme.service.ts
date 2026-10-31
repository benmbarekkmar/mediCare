import { Injectable, computed, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'medicare.theme';

/**
 * Light and dark themes through CSS custom properties. The mode is persisted,
 * `system` follows the OS and keeps following it while the app is open.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly modeSignal = signal<ThemeMode>(readMode());
  private readonly systemDark = signal(this.media.matches);

  readonly mode = computed(() => this.modeSignal());
  readonly resolved = computed<ResolvedTheme>(() =>
    this.modeSignal() === 'system' ? (this.systemDark() ? 'dark' : 'light') : (this.modeSignal() as ResolvedTheme),
  );

  constructor() {
    const onChange = (event: MediaQueryListEvent): void => this.systemDark.set(event.matches);
    this.media.addEventListener('change', onChange);
    this.apply();
  }

  setMode(mode: ThemeMode): void {
    this.modeSignal.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* storage disabled */
    }
    this.apply();
  }

  toggle(): void {
    this.setMode(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  /** Called after Angular bootstrap: the pre-paint script may have set the attribute already. */
  apply(): void {
    document.documentElement.dataset['theme'] = this.resolved();
  }
}

function readMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* fall through */
  }
  return 'system';
}
