import { Component, signal } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../../core/toast/toast.service';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiCodeBlockComponent, type CodeLanguage, tokenizeCode } from './ui-code-block.component';

const QUERY = `# the last ten bookings
PREFIX ex: <http://example.org/medicare#>
SELECT ?patient WHERE { ?patient ex:hasAppointment ?appt . FILTER(?appt < "2026-01-01") } LIMIT 10`;

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-host',
  standalone: true,
  imports: [UiCodeBlockComponent],
  template: `
    <ui-code-block
      [code]="code()"
      [language]="language()"
      [copyable]="copyable()"
      [label]="label()"
      [wrap]="wrap()"
    />
  `,
})
class TestHostComponent {
  readonly code = signal('');
  readonly language = signal<CodeLanguage>('sparql');
  readonly copyable = signal(true);
  readonly label = signal<string | null>(null);
  readonly wrap = signal(false);
}

const kindsOf = (code: string, language: CodeLanguage): string[] =>
  tokenizeCode(code, language).map((token) => token.kind);

const textOf = (code: string, language: CodeLanguage): string[] =>
  tokenizeCode(code, language).map((token) => token.text);

describe('tokenizeCode', () => {
  it('splits a SPARQL query into comments, keywords, variables, IRIs, prefixed names and literals', () => {
    const kinds = kindsOf(QUERY, 'sparql');
    expect(kinds[0]).toBe('comment');
    expect(kinds).toContain('kw');
    expect(kinds).toContain('iri');
    expect(kinds).toContain('var');
    expect(kinds).toContain('pname');
    expect(kinds).toContain('literal');
    expect(kinds).toContain('number');
    expect(textOf('SELECT DISTINCT', 'sparql')).toEqual(['SELECT', ' ', 'DISTINCT']);
    expect(kindsOf('SELECT DISTINCT', 'sparql')).toEqual(['kw', 'plain', 'kw']);
  });

  it('keeps every character of the query', () => {
    expect(tokenizeCode(QUERY, 'sparql').map((token) => token.text).join('')).toBe(QUERY);
  });

  it('tells a JSON key from a JSON value', () => {
    expect(kindsOf('{"a": 1, "b": true}', 'json')).toEqual([
      'punct',
      'key',
      'punct',
      'plain',
      'number',
      'punct',
      'plain',
      'key',
      'punct',
      'plain',
      'kw',
      'punct',
    ]);
  });

  it('highlights the Turtle shorthand for the type predicate', () => {
    expect(kindsOf('ex:pat a ex:Patient .', 'ttl')).toEqual([
      'pname',
      'plain',
      'kw',
      'plain',
      'pname',
      'plain',
      'punct',
    ]);
  });

  it('leaves plain text untouched', () => {
    expect(tokenizeCode('no highlighting here', 'text')).toEqual([{ text: 'no highlighting here', kind: 'plain' }]);
    expect(tokenizeCode('', 'sparql')).toEqual([]);
  });
});

describe('UiCodeBlockComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let root: HTMLElement;
  let writeText: jasmine.Spy;

  const mockClipboard = (value: { writeText: jasmine.Spy } | undefined): void => {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, TestHostComponent],
    }).compileComponents();

    TestBed.inject(TranslateService).setDefaultLang('en');
    writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    mockClipboard({ writeText });
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    host.code.set(QUERY);
    fixture.detectChanges();
  });

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>)['clipboard'];
  });

  it('renders one coloured span per token and keeps the whitespace', () => {
    const spans = [...root.querySelectorAll<HTMLSpanElement>('.ui-code__body span')];
    expect(spans.length).toBe(tokenizeCode(QUERY, 'sparql').length);
    expect(spans[0]?.className).toContain('tk-comment');
    expect(spans.map((span) => span.textContent).join('')).toBe(QUERY);
    expect(root.querySelector('.ui-code__lang')?.textContent).toBe('sparql');
  });

  it('uses the label input and falls back to the generic code label', () => {
    expect(root.querySelector('.ui-code__label')?.textContent?.trim()).toBe('ui.code.label');
    host.label.set('Generated query');
    fixture.detectChanges();
    expect(root.querySelector('.ui-code__label')?.textContent?.trim()).toBe('Generated query');
  });

  it('copies through the clipboard API and confirms with a toast', fakeAsync(() => {
    const success = spyOn(ToastService.prototype, 'success');
    root.querySelector<HTMLButtonElement>('.ui-code__copy')?.click();
    tick();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith(QUERY);
    expect(success).toHaveBeenCalledWith('ui.code.copied');
    expect(root.querySelector<HTMLButtonElement>('.ui-code__copy')?.textContent).toContain('ui.code.copied');

    tick(2000);
    fixture.detectChanges();
    expect(root.querySelector<HTMLButtonElement>('.ui-code__copy')?.textContent).toContain('ui.code.copy');
  }));

  it('falls back to the selection trick without the clipboard API', fakeAsync(() => {
    mockClipboard(undefined);
    const success = spyOn(ToastService.prototype, 'success');
    const execCommand = spyOn(document, 'execCommand').and.returnValue(true);

    root.querySelector<HTMLButtonElement>('.ui-code__copy')?.click();
    tick();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(success).toHaveBeenCalledWith('ui.code.copied');
    expect(document.querySelectorAll('textarea').length).toBe(0);
    tick(2000);
  }));

  it('warns when both copy paths fail', fakeAsync(() => {
    mockClipboard(undefined);
    spyOn(document, 'execCommand').and.returnValue(false);
    const warning = spyOn(ToastService.prototype, 'warning');

    root.querySelector<HTMLButtonElement>('.ui-code__copy')?.click();
    tick();

    expect(warning).toHaveBeenCalledWith('uidata.code.copyFailed');
  }));

  it('hides the copy button when it is not copyable and keeps it labelled', () => {
    expect(root.querySelector<HTMLButtonElement>('.ui-code__copy')?.getAttribute('aria-label')).toBe(
      'uidata.code.copy',
    );
    host.copyable.set(false);
    fixture.detectChanges();
    expect(root.querySelector('.ui-code__copy')).toBeNull();
  });

  it('applies the height cap and the wrap mode', () => {
    const pre = root.querySelector('pre');
    expect(pre?.getAttribute('style')).toContain('max-height');
    host.wrap.set(true);
    fixture.detectChanges();
    expect(pre?.className).toContain('ui-code__pre--wrap');
  });
});
