import { Injectable, computed, inject, signal } from '@angular/core';
import { EntitiesService } from '../core/api/entity.service';
import type { Individual } from '../core/api/models';
import { relativeTime } from '../core/util/format';

/**
 * The bell in the top bar lists the appointments that still have to happen.
 * The same `/appointments?upcoming=true` call already returns the scoped slice
 * for a DOCTOR or a PATIENT, so no client side filtering is needed.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly entities = inject(EntitiesService);

  readonly items = signal<Individual[]>([]);
  readonly loading = signal(false);
  readonly count = computed(() => this.items().length);

  refresh(): void {
    this.loading.set(true);
    this.entities
      .list('appointments', { upcoming: true, sort: 'date', order: 'asc', pageSize: 8 })
      .subscribe({
        next: (page) => {
          this.items.set(page.items);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  when(appointment: Individual): string {
    const date = appointment.fields['date'];
    return typeof date === 'string' ? relativeTime(date) : '';
  }
}
