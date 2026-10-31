import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Ref } from '../../../core/api/models';
import { UiConfirmDialogComponent, type ConfirmDependent } from './ui-confirm-dialog.component';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-confirm-dialog-host',
  standalone: true,
  imports: [UiConfirmDialogComponent],
  template: `
    <ui-confirm-dialog
      [open]="open()"
      title="Delete Cardinal Clinic"
      [message]="message()"
      [dependents]="dependents()"
      [reassignOptions]="reassignOptions()"
      [reassignTo]="reassignTo()"
      [busy]="busy()"
      (openChange)="open.set($event)"
      (reassignToChange)="reassignTo.set($event)"
      (confirmed)="confirm()"
    />
  `,
})
class UiConfirmDialogHostComponent {
  readonly open = signal(true);
  readonly message = signal<string | null>('This hospital still owns departments.');
  readonly dependents = signal<ConfirmDependent[] | null>(null);
  readonly reassignOptions = signal<Ref[] | null>(null);
  readonly reassignTo = signal<string | null>(null);
  readonly busy = signal(false);
  readonly confirmations = signal(0);

  confirm(): void {
    this.confirmations.update((count) => count + 1);
  }
}

describe('UiConfirmDialogComponent', () => {
  let fixture: ComponentFixture<UiConfirmDialogHostComponent>;

  const departments: ConfirmDependent[] = [
    { entity: 'Departments', id: 'dep-1', label: 'Cardiology', predicate: 'hasDepartment' },
    { entity: 'Departments', id: 'dep-2', label: 'Neurology', predicate: 'hasDepartment' },
    { entity: 'Doctors', id: 'doc-1', label: 'Dr. Aurelio', predicate: 'worksAt' },
  ];

  const targets: Ref[] = [
    { id: 'hosp-2', iri: 'urn:hospital:2', label: 'Saint-Luc', type: 'Hospital' },
    { id: 'hosp-3', iri: 'urn:hospital:3', label: 'Erasme', type: 'Hospital' },
  ];

  function host(): UiConfirmDialogHostComponent {
    return fixture.componentInstance;
  }

  function confirmButton(): HTMLButtonElement | null {
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.ui-confirm__button');
    return buttons.length > 0 ? buttons[buttons.length - 1] : null;
  }

  function select(): HTMLSelectElement | null {
    return fixture.nativeElement.querySelector('select.ui-control');
  }

  function chooseTarget(id: string): void {
    const element = select();
    if (!element) return;
    element.value = id;
    element.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, UiConfirmDialogHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UiConfirmDialogHostComponent);
    fixture.detectChanges();
  });

  it('renders the dialog without a dependent section when there are none', () => {
    expect(fixture.nativeElement.querySelector('.ui-confirm__warning')).toBeNull();
    expect(confirmButton()?.disabled).toBe(false);
  });

  it('lists the dependents grouped by entity and warns with the count', () => {
    host().dependents.set(departments);
    fixture.detectChanges();

    const titles = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.ui-confirm__group-title');
    expect([...titles].map((element) => element.textContent?.trim())).toEqual(['Departments', 'Doctors']);
    expect(fixture.nativeElement.querySelectorAll('.ui-confirm__item')).toHaveSize(3);
    expect(fixture.nativeElement.querySelector('.ui-confirm__warning')?.textContent).toContain(
      'ui.confirm.dependentsWarning',
    );
    expect(select()).toBeNull();
  });

  it('keeps confirm disabled until the reassign select has a value', () => {
    host().dependents.set(departments);
    host().reassignOptions.set(targets);
    fixture.detectChanges();

    expect(select()).toBeTruthy();
    expect(confirmButton()?.disabled).toBe(true);

    chooseTarget('hosp-2');
    expect(host().reassignTo()).toBe('hosp-2');
    expect(confirmButton()?.disabled).toBe(false);
  });

  it('emits confirmed without closing, and ignores the click while disabled', () => {
    host().dependents.set(departments);
    host().reassignOptions.set(targets);
    fixture.detectChanges();

    confirmButton()?.click();
    fixture.detectChanges();
    expect(host().confirmations()).toBe(0);
    expect(host().open()).toBe(true);

    chooseTarget('hosp-3');
    confirmButton()?.click();
    fixture.detectChanges();
    expect(host().confirmations()).toBe(1);
    expect(host().open()).toBe(true);
  });

  it('disables the gate while busy and lets the caller close it', () => {
    host().busy.set(true);
    fixture.detectChanges();
    expect(confirmButton()?.disabled).toBe(true);

    host().busy.set(false);
    fixture.detectChanges();
    const backdrop = fixture.nativeElement.querySelector('.ui-modal__backdrop') as HTMLElement;
    backdrop.click();
    fixture.detectChanges();
    expect(host().open()).toBe(false);
    expect(fixture.nativeElement.querySelector('.ui-modal')).toBeNull();
  });

  it('cancels without confirming', () => {
    const cancel = fixture.nativeElement.querySelector('.ui-confirm__button--ghost') as HTMLButtonElement;
    cancel.click();
    fixture.detectChanges();

    expect(host().open()).toBe(false);
    expect(host().confirmations()).toBe(0);
  });
});
