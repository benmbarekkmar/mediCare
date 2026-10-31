import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToastService, type ToastKind } from '../../../core/toast/toast.service';
import { UiToastHostComponent } from './ui-toast-host.component';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-toast-host-spec-host',
  standalone: true,
  imports: [UiToastHostComponent],
  template: `<ui-toast-host [maxVisible]="limit()" />`,
})
class UiToastHostHostComponent {
  readonly limit = signal(5);
}

describe('UiToastHostComponent', () => {
  let fixture: ComponentFixture<UiToastHostHostComponent>;
  let toasts: ToastService;

  function push(kind: ToastKind, title: string, message?: string): number {
    // ms = 0 keeps the service from scheduling an auto-dismiss timer in a spec.
    return toasts.show(kind, title, message, 0);
  }

  function rendered(): NodeListOf<HTMLElement> {
    return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.ui-toast');
  }

  function pressKey(key: string): void {
    const stack = fixture.nativeElement.querySelector('.ui-toast-stack') as HTMLElement;
    stack.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, UiToastHostHostComponent],
    }).compileComponents();

    toasts = TestBed.inject(ToastService);
    toasts.clear();
    fixture = TestBed.createComponent(UiToastHostHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => toasts.clear());

  it('renders an announced live region', () => {
    const stack = fixture.nativeElement.querySelector('.ui-toast-stack') as HTMLElement;
    expect(stack.getAttribute('role')).toBe('status');
    expect(stack.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the title, the message and the kind icon', () => {
    push('success', 'Appointment saved', 'Confirmed for Monday');
    fixture.detectChanges();

    const toast = rendered()[0];
    expect(rendered()).toHaveSize(1);
    expect(toast.getAttribute('data-kind')).toBe('success');
    expect(toast.querySelector('.ui-toast__title')?.textContent?.trim()).toBe('Appointment saved');
    expect(toast.querySelector('.ui-toast__message')?.textContent?.trim()).toBe('Confirmed for Monday');
    expect(toast.querySelector('lucide-icon')).toBeTruthy();
  });

  it('caps the stack and keeps the newest toasts', () => {
    for (let index = 1; index <= 7; index += 1) push('info', `Toast ${index}`);
    fixture.detectChanges();

    expect(rendered()).toHaveSize(5);
    expect(rendered()[4].querySelector('.ui-toast__title')?.textContent?.trim()).toBe('Toast 7');
    expect(rendered()[0].querySelector('.ui-toast__title')?.textContent?.trim()).toBe('Toast 3');

    fixture.componentInstance.limit.set(2);
    fixture.detectChanges();
    expect(rendered()).toHaveSize(2);
  });

  it('only draws a countdown bar on error toasts', () => {
    push('error', 'Store unreachable', 'Ontology write refused');
    push('warning', 'Check the dates');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.ui-toast[data-kind="error"] .ui-toast__progress')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.ui-toast[data-kind="warning"] .ui-toast__progress')).toBeNull();
    const bar = fixture.nativeElement.querySelector('.ui-toast__progress') as HTMLElement;
    expect(bar.style.animationDuration).toBe('5000ms');
  });

  it('dismisses a single toast from its close button', () => {
    push('info', 'First');
    push('info', 'Second');
    fixture.detectChanges();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.ui-toast__dismiss');
    buttons[0].click();
    fixture.detectChanges();

    expect(rendered()).toHaveSize(1);
    expect(rendered()[0].querySelector('.ui-toast__title')?.textContent?.trim()).toBe('Second');
  });

  it('dismisses the newest toast on Enter and the stack on Escape', () => {
    push('info', 'First');
    push('info', 'Second');
    fixture.detectChanges();

    pressKey('Enter');
    expect(rendered()).toHaveSize(1);
    expect(rendered()[0].querySelector('.ui-toast__title')?.textContent?.trim()).toBe('First');

    pressKey('Escape');
    expect(rendered()).toHaveSize(0);
    expect(toasts.toasts()).toEqual([]);
  });
});
