import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { ThemeService } from './core/theme/theme.service';
import { UnsavedChangesService } from './core/auth/guards';

/**
 * The root only wires the one-shot boot work: restore the session, validate it
 * against /auth/me, load the permission matrix and apply the stored theme.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
})
export class AppComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly unsaved = inject(UnsavedChangesService);

  ngOnInit(): void {
    this.theme.apply();
    this.auth.bootstrap();
    this.unsaved.watch();
  }
}
