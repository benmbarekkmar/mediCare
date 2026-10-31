import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UiTooltipDirective } from './ui-tooltip.directive';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-tooltip-host',
  standalone: true,
  imports: [UiTooltipDirective],
  template: `
    <button type="button" [uiTooltip]="label()" [position]="side()">Sort</button>
    <button type="button" [uiTooltip]="second()">Filter</button>
  `,
})
class UiTooltipHostComponent {
  readonly label = signal('Server-side sorting');
  readonly second = signal('Refine the list');
  readonly side = signal<'top' | 'bottom' | 'left' | 'right'>('top');
}

/** Pretends the device has no hover, the way a phone reports itself. */
function emulateTouchDevice(): () => void {
  const own = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: true, media: query }) as unknown as MediaQueryList,
  });
  return () => {
    if (own) {
      Object.defineProperty(window, 'matchMedia', own);
    } else {
      delete (window as unknown as Record<string, unknown>)['matchMedia'];
    }
  };
}

describe('UiTooltipDirective', () => {
  let fixture: ComponentFixture<UiTooltipHostComponent>;
  let trigger: HTMLButtonElement;

  function tooltips(): NodeListOf<HTMLElement> {
    return document.querySelectorAll<HTMLElement>('.ui-tooltip');
  }

  function front(): HTMLElement | null {
    const list = tooltips();
    return list.length > 0 ? list[list.length - 1] : null;
  }

  beforeEach(async () => {
    jasmine.clock().install();

    await TestBed.configureTestingModule({
      imports: [UiTooltipHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UiTooltipHostComponent);
    fixture.detectChanges();
    trigger = fixture.nativeElement.querySelector('button');
  });

  afterEach(() => jasmine.clock().uninstall());

  it('waits for the delay before it appears', () => {
    trigger.dispatchEvent(new MouseEvent('mouseenter'));

    expect(tooltips()).toHaveSize(0);

    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    jasmine.clock().tick(249);
    expect(tooltips()).toHaveSize(0);

    jasmine.clock().tick(2);
    expect(front()?.getAttribute('role')).toBe('tooltip');
    expect(front()?.textContent).toBe('Server-side sorting');
    expect(trigger.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('attaches the panel to the body and links it with aria-describedby', () => {
    const directive = fixture.debugElement
      .query(By.directive(UiTooltipDirective))
      .injector.get(UiTooltipDirective);

    directive.showNow();

    const panel = front();
    expect(panel).toBeTruthy();
    expect(panel?.parentElement).toBe(document.body);
    expect(trigger.getAttribute('aria-describedby')).toBe(panel ? panel.id : null);

    directive.dismiss();
    expect(tooltips()).toHaveSize(0);
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('leaves again on pointer out, on blur and on Escape', () => {
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    jasmine.clock().tick(300);
    expect(tooltips()).toHaveSize(1);
    trigger.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tooltips()).toHaveSize(0);

    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    jasmine.clock().tick(300);
    trigger.dispatchEvent(new FocusEvent('blur'));
    expect(tooltips()).toHaveSize(0);

    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    jasmine.clock().tick(300);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tooltips()).toHaveSize(0);
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('dismisses when the page scrolls so it never floats loose', () => {
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    jasmine.clock().tick(300);
    expect(tooltips()).toHaveSize(1);

    window.dispatchEvent(new Event('scroll'));
    expect(tooltips()).toHaveSize(0);
  });

  it('flips a top tooltip under the control when the viewport is in the way', () => {
    trigger.style.position = 'fixed';
    trigger.style.top = '0px';
    trigger.style.left = '0px';
    fixture.detectChanges();

    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    jasmine.clock().tick(300);

    const panel = front();
    expect(panel).toBeTruthy();
    expect(Number.parseFloat(panel?.style.top ?? '0')).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(trigger.getBoundingClientRect().top.toFixed(2))).toBeCloseTo(0, 0);
  });

  it('shows nothing on a touch device', () => {
    const restore = emulateTouchDevice();
    try {
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      jasmine.clock().tick(1000);
      expect(tooltips()).toHaveSize(0);
      expect(trigger.getAttribute('aria-describedby')).toBeNull();
    } finally {
      restore();
    }
  });

  it('injects one shared stylesheet for every instance', () => {
    const second = fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement;
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    second.dispatchEvent(new MouseEvent('mouseenter'));
    jasmine.clock().tick(300);

    expect(tooltips()).toHaveSize(2);
    expect(document.querySelectorAll('#ui-tooltip-styles')).toHaveSize(1);
  });

  it('cleans the DOM up when the host is destroyed', () => {
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    jasmine.clock().tick(300);
    expect(tooltips()).toHaveSize(1);

    fixture.destroy();
    expect(tooltips()).toHaveSize(0);
  });
});
