import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivationEnd, Router, type ActivatedRouteSnapshot } from '@angular/router';
import { filter } from 'rxjs/operators';

export interface Crumb {
  labelKey: string | null;
  label: string | null;
  href: string | null;
}

/**
 * Breadcrumbs are derived from the activated route tree, so a page only declares
 * `data.crumbKey`; a detail page can override the last crumb with the label of
 * the individual it loaded.
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbsService {
  private readonly router = inject(Router);
  private readonly tail = signal<Crumb | null>(null);

  readonly crumbs = signal<Crumb[]>([]);
  readonly trail = computed(() => {
    const list = this.crumbs();
    const extra = this.tail();
    return extra ? [...list.slice(0, -1), extra] : list;
  });

  constructor() {
    this.router.events
      .pipe(filter((event): event is ActivationEnd => event instanceof ActivationEnd))
      .subscribe(() => this.collect());
  }

  /** Called by detail pages once the individual's label is known. */
  setTail(label: string | null): void {
    this.tail.set(label ? { labelKey: null, label, href: null } : null);
  }

  private collect(): void {
    const crumbs: Crumb[] = [];
    let node: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    while (node) {
      const key = node.data['crumbKey'] as string | undefined;
      const url = node.url.map((segment) => segment.path).join('/');
      if (key) crumbs.push({ labelKey: key, label: null, href: crumbs.length === 0 ? null : `/${url}` });
      node = node.firstChild;
    }
    this.crumbs.set(crumbs);
    this.tail.set(null);
  }
}
