import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UiModalComponent } from './ui-modal.component';
import { FocusTrapDirective } from '../focus-trap.directive';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-modal-host',
  standalone: true,
  imports: [UiModalComponent],
  template: `
    <ui-modal
      [open]="open()"
      [title]="title()"
      [subtitle]="subtitle()"
      [busy]="busy()"
      [dismissible]="dismissible()"
      (openChange)="onChange($event)"
    >
      <p class="projected">Diagnosis form</p>
      <ng-template #footer>
        <button type="button" class="footer-button">Save</button>
      </ng-template>
    </ui-modal>
  `,
})
class UiModalHostComponent {
  readonly open = signal(false);
  readonly title = signal('Add a diagnosis');
  readonly subtitle = signal<string | null>(null);
  readonly busy = signal(false);
  readonly dismissible = signal(true);
  readonly changes = signal<boolean[]>([]);

  onChange(value: boolean): void {
    this.changes.update((list) => [...list, value]);
    this.open.set(value);
  }
}

describe('UiModalComponent', () => {
  let fixture: ComponentFixture<UiModalHostComponent>;

  function host(): UiModalHostComponent {
    return fixture.componentInstance;
  }

  function panel(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.ui-modal');
  }

  function pressEscape(): void {
    const element = panel();
    element?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
  }

  function clickBackdrop(): void {
    (fixture.nativeElement.querySelector('.ui-modal__backdrop') as HTMLElement).click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, UiModalHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UiModalHostComponent);
    fixture.detectChanges();
  });

  it('renders no overlay while closed', () => {
    expect(panel()).toBeNull();
    expect(fixture.nativeElement.querySelector('.ui-modal__backdrop')).toBeNull();
  });

  it('exposes a labelled modal dialog with the projected body and footer', () => {
    host().subtitle.update(() => 'Optional clinical note');
    host().open.set(true);
    fixture.detectChanges();

    const dialog = panel();
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    const titleId = dialog?.querySelector('h2')?.id;
    expect(titleId).toBeTruthy();
    expect(dialog?.getAttribute('aria-labelledby')).toBe(titleId);
    expect(dialog?.getAttribute('aria-describedby')).toBeTruthy();
    expect(dialog?.querySelector('.projected')?.textContent).toContain('Diagnosis form');
    expect(dialog?.querySelector('.footer-button')?.textContent).toContain('Save');
  });

  it('applies the shared focus trap to the dialog panel', () => {
    host().open.set(true);
    fixture.detectChanges();

    const trapped = fixture.debugElement.query(By.directive(FocusTrapDirective));
    expect(trapped).toBeTruthy();
    expect(trapped.nativeElement.classList.contains('ui-modal')).toBe(true);
    expect(trapped.nativeElement.querySelector('button')).toBeTruthy();
  });

  it('closes on Escape and emits openChange false', () => {
    host().open.set(true);
    fixture.detectChanges();
    pressEscape();

    expect(host().changes()).toEqual([false]);
    expect(host().open()).toBe(false);
    expect(panel()).toBeNull();
  });

  it('closes on a backdrop click and on the close button', () => {
    host().open.set(true);
    fixture.detectChanges();
    clickBackdrop();
    expect(host().open()).toBe(false);

    host().open.set(true);
    fixture.detectChanges();
    const close = fixture.nativeElement.querySelector('.ui-modal__close') as HTMLButtonElement;
    close.click();
    fixture.detectChanges();
    expect(host().open()).toBe(false);
    expect(panel()).toBeNull();
  });

  it('keeps the dialog open while busy', () => {
    host().open.set(true);
    host().busy.set(true);
    fixture.detectChanges();

    pressEscape();
    expect(host().open()).toBe(true);
    clickBackdrop();
    expect(host().open()).toBe(true);
    expect(host().changes()).toEqual([]);
  });

  it('honours dismissible false by hiding the close button', () => {
    host().dismissible.set(false);
    host().open.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.ui-modal__close')).toBeNull();
    pressEscape();
    expect(host().open()).toBe(true);
  });

  it('restores the body scroll lock when the dialog closes', () => {
    host().open.set(true);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');

    pressEscape();
    expect(document.body.classList.contains('ui-overlay-scroll-lock')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});
