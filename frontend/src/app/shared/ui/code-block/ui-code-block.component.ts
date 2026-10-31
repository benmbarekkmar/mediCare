import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../../core/toast/toast.service';
import { UiIconComponent } from '../icon/ui-icon.component';

export type CodeLanguage = 'sparql' | 'json' | 'ttl' | 'text';

export type TokenKind =
  | 'kw'
  | 'iri'
  | 'pname'
  | 'literal'
  | 'var'
  | 'comment'
  | 'number'
  | 'punct'
  | 'key'
  | 'plain';

export interface CodeToken {
  text: string;
  kind: TokenKind;
}

interface Rule {
  kind: TokenKind;
  pattern: RegExp;
}

/** `y` (sticky) anchors every rule to the current scan position. */
const rule = (kind: TokenKind, source: string): Rule => ({ kind, pattern: new RegExp(source, 'y') });

const SPARQL_KEYWORDS =
  'SELECT|DISTINCT|CONSTRUCT|DESCRIBE|ASK|WHERE|FILTER|OPTIONAL|UNION|BIND|AS|ORDER|BY|LIMIT|OFFSET|VALUES|PREFIX|BASE|GRAPH|FROM|NAMED|USING|INSERT|DELETE|DATA|CLEAR|CREATE|DROP|ADD|MOVE|COPY|SILENT|EXISTS|NOT|IN|IS|IRI|BNODE|STR|LANG|LANGMATCHES|DATATYPE|BOUND|SAMEAS|CONTAINS|STRSTARTS|STRENDS|REGEX|REPLACE|STRLEN|UCASE|LCASE|CONCAT|COALESCE|IF|COUNT|SUM|AVG|MIN|MAX|SAMPLE|GROUP_CONCAT|SEPARATOR|ASC|DESC|NOW|YEAR|MONTH|DAY|HOURS|MINUTES|SECOND|TIMEZONE|RAND|ABS|CEIL|FLOOR|ROUND|MD5|SHA1|UUID|STRUUID|ENCODE_FOR_URI|TRUE|FALSE';

const sparqlRules: Rule[] = [
  rule('comment', '#[^\\n]*'),
  rule(
    'literal',
    '(?:"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')(?:@\\w[\\w-]*|\\^\\^(?:<[^<>\\s]*>|[\\w:.-]+))?',
  ),
  rule('iri', '<[^<>\\s]*>'),
  rule('var', '[?$][A-Za-z0-9_][\\w-]*'),
  rule('number', '0[xX][0-9a-fA-F]+|[-+]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?'),
  rule('kw', `(?:${SPARQL_KEYWORDS})\\b`),
  // the shorthand for rdf:type, and only when it stands alone
  rule('kw', '\\ba\\b(?=\\s)'),
  rule('pname', '[A-Za-z_][\\w.-]*:[\\w.-]*'),
  rule('punct', '[{}()\\[\\],;.]'),
  rule('plain', '[A-Za-z_][\\w-]*'),
];

const ttlRules: Rule[] = [
  rule('comment', '#[^\\n]*'),
  rule(
    'literal',
    '(?:"""[\\s\\S]*?"""|"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')(?:@\\w[\\w-]*|\\^\\^(?:<[^<>\\s]*>|[\\w:.-]+))?',
  ),
  rule('iri', '<[^<>\\s]*>'),
  rule('var', '[?$][A-Za-z0-9_][\\w-]*'),
  rule('kw', '\\b(?:true|false)\\b'),
  rule('kw', '\\ba\\b(?!\\w)'),
  rule('number', '[-+]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?'),
  rule('pname', '[A-Za-z_][\\w.-]*:[\\w.-]*'),
  rule('punct', '[{}()\\[\\],;.]'),
  rule('plain', '[A-Za-z_][\\w-]*'),
];

const jsonRules: Rule[] = [
  rule('key', '"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)'),
  rule('literal', '"(?:[^"\\\\]|\\\\.)*"'),
  rule('number', '[-+]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?'),
  rule('kw', '\\b(?:true|false|null)\\b'),
  rule('punct', '[{}\\[\\]:,]'),
];

const RULES: Record<CodeLanguage, Rule[] | null> = {
  sparql: sparqlRules,
  ttl: ttlRules,
  json: jsonRules,
  text: null,
};

/**
 * A dependency-free highlighter: keywords, IRIs, literals, variables and
 * comments for the query languages, keys and values for JSON. Everything it
 * does not recognise stays plain text, so no character is ever swallowed.
 */
export function tokenizeCode(code: string, language: CodeLanguage): CodeToken[] {
  const rules = RULES[language];
  if (rules === null) return code.length === 0 ? [] : [{ text: code, kind: 'plain' }];
  if (code.length === 0) return [];

  const tokens: CodeToken[] = [];
  let plain = '';
  let position = 0;

  const flush = (): void => {
    if (plain.length > 0) {
      tokens.push({ text: plain, kind: 'plain' });
      plain = '';
    }
  };

  while (position < code.length) {
    let matched = false;
    for (const current of rules) {
      current.pattern.lastIndex = position;
      const found = current.pattern.exec(code);
      if (found === null || found[0].length === 0) continue;
      flush();
      tokens.push({ text: found[0], kind: current.kind });
      position += found[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      const character = code.charAt(position);
      plain += character;
      position += 1;
    }
  }
  flush();
  return tokens;
}

/**
 * A read-only code surface: highlighted, scrollable and copyable. The SPARQL
 * console, the assistant explanations and the ontology explorer all show
 * queries through it.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ui-code-block',
  standalone: true,
  imports: [TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-code">
      <div class="ui-code__head">
        <span class="ui-code__label">{{ label() ?? ('ui.code.label' | translate) }}</span>
        <span class="ui-code__lang">{{ language() }}</span>
        @if (copyable()) {
          <button
            type="button"
            class="ui-code__copy"
            [attr.aria-label]="'uidata.code.copy' | translate: { language: language() }"
            (click)="copy()"
          >
            <ui-icon [name]="copied() ? 'check' : 'copy'" [size]="14" />
            <span>{{ (copied() ? 'ui.code.copied' : 'ui.code.copy') | translate }}</span>
          </button>
        }
      </div>
      <pre class="ui-code__pre" [class.ui-code__pre--wrap]="wrap()" [style.max-height]="maxHeight()" tabindex="0"><code class="ui-code__body">@for (token of tokens(); track $index) {<span [class]="tokenClass(token)">{{ token.text }}</span>}</code></pre>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ui-code {
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        background: var(--surface-alt);
        overflow: hidden;
      }
      .ui-code__head {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        padding: var(--sp-2) var(--sp-3);
        border-bottom: 1px solid var(--border);
        background: var(--surface);
      }
      .ui-code__label {
        font-size: var(--fs-xs);
        font-weight: 650;
        color: var(--text-muted);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .ui-code__lang {
        font-size: var(--fs-xs);
        color: var(--text-subtle);
        font-family: var(--font-mono);
      }
      .ui-code__copy {
        margin-inline-start: auto;
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        padding: 2px var(--sp-2);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-input);
        background: var(--surface);
        color: var(--text-muted);
        font: inherit;
        font-size: var(--fs-xs);
        font-weight: 600;
        cursor: pointer;
        transition:
          color var(--duration-fast) var(--ease),
          border-color var(--duration-fast) var(--ease);
      }
      .ui-code__copy:hover {
        color: var(--primary);
        border-color: var(--primary);
      }
      .ui-code__copy:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .ui-code__pre {
        margin: 0;
        padding: var(--sp-3);
        overflow: auto;
        background: var(--surface-alt);
        scrollbar-width: thin;
      }
      .ui-code__body {
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        line-height: 1.6;
        color: var(--text);
        white-space: pre;
      }
      .ui-code__pre--wrap .ui-code__body {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .tk-kw {
        color: var(--primary);
        font-weight: 650;
      }
      .tk-key {
        color: var(--primary-hover);
        font-weight: 650;
      }
      .tk-iri,
      .tk-pname {
        color: var(--secondary);
      }
      .tk-literal {
        color: var(--danger-700);
      }
      .tk-var {
        color: var(--accent);
        font-weight: 600;
      }
      .tk-number {
        color: var(--warning-700);
      }
      .tk-comment {
        color: var(--text-subtle);
        font-style: italic;
      }
      .tk-punct {
        color: var(--text-muted);
      }
      @media (max-width: 1024px) {
        .ui-code__pre {
          padding: var(--sp-2);
        }
      }
    `,
  ],
})
export class UiCodeBlockComponent {
  readonly code = input('');
  readonly language = input<CodeLanguage>('sparql');
  readonly copyable = input(true, { transform: booleanAttribute });
  readonly label = input<string | null>(null);
  readonly maxHeight = input('320px');
  readonly wrap = input(false, { transform: booleanAttribute });

  protected readonly tokens = computed(() => tokenizeCode(this.code(), this.language()));
  protected readonly copied = signal(false);

  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer !== null) clearTimeout(this.timer);
    });
  }

  protected tokenClass(token: CodeToken): string {
    return `tk tk-${token.kind}`;
  }

  protected copy(): void {
    const text = this.code();
    if (text.length === 0) return;
    void writeClipboard(text).then((ok) => {
      if (!ok) {
        this.toast.warning(this.translate.instant('uidata.code.copyFailed'));
        return;
      }
      this.copied.set(true);
      this.toast.success(this.translate.instant('ui.code.copied'));
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.copied.set(false), 2000);
    });
  }
}

/** The async clipboard, with the legacy selection trick for insecure origins. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* the permission or the context refused it: fall through to the copy trick */
  }
  return legacyCopy(text);
}

const legacyCopy = (text: string): boolean => {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'visually-hidden';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
};
