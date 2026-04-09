import type { ElementKind, TargetDescriptor } from '../shared/types';

// ──────────────────────────────────────────────
// Build a TargetDescriptor from a DOM element
// ──────────────────────────────────────────────

export function buildTargetDescriptor(el: Element): TargetDescriptor {
  const tag = el.tagName.toLowerCase();
  const kind = inferKind(el);
  const attributes = getAttributes(el);

  return {
    kind,
    tagName: tag,
    attributes,
    selectorCandidates: getCssSelectors(el),
    xpathCandidates: [getXPath(el)],
    label: getLabel(el),
    text: getVisibleText(el) || undefined,
    placeholder: (el as HTMLInputElement).placeholder || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    containerText: getContainerText(el) || undefined,
  };
}

// ──────────────────────────────────────────────
// Infer semantic kind
// ──────────────────────────────────────────────

function inferKind(el: Element): ElementKind {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  const type = (el as HTMLInputElement).type?.toLowerCase();

  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'input') {
    if (type === 'submit' || type === 'button') return 'button';
    return 'input';
  }
  if (tag === 'td' || tag === 'th') return 'table_cell';
  if (role === 'link') return 'link';
  if (role === 'checkbox' || role === 'radio') return 'input';
  return 'generic';
}

// ──────────────────────────────────────────────
// CSS selector generation
// ──────────────────────────────────────────────

export function getCssSelectors(el: Element): string[] {
  const selectors: string[] = [];

  // 1. ID-based selector
  if (el.id && /^[a-zA-Z_]/.test(el.id)) {
    selectors.push(`#${CSS.escape(el.id)}`);
  }

  // 2. Name attribute
  const name = el.getAttribute('name');
  if (name) {
    selectors.push(`${el.tagName.toLowerCase()}[name="${name}"]`);
  }

  // 3. data-testid or data-cy
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-cy');
  if (testId) {
    selectors.push(`[data-testid="${testId}"]`);
  }

  // 4. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    selectors.push(`[aria-label="${ariaLabel}"]`);
  }

  // 5. type + placeholder combo for inputs
  if (el.tagName.toLowerCase() === 'input') {
    const type = el.getAttribute('type');
    const ph = el.getAttribute('placeholder');
    if (ph) selectors.push(`input[placeholder="${ph}"]`);
    if (type && ph) selectors.push(`input[type="${type}"][placeholder="${ph}"]`);
  }

  // 6. Unique class combination
  const classSelector = buildClassSelector(el);
  if (classSelector) selectors.push(classSelector);

  // 7. Structural selector as fallback
  selectors.push(buildStructuralSelector(el));

  return [...new Set(selectors)].filter(Boolean);
}

function buildClassSelector(el: Element): string | null {
  const classes = [...el.classList].filter(
    (c) => !c.match(/^(hover|focus|active|disabled|selected|js-)/) && c.length > 2
  );
  if (classes.length === 0) return null;
  const cls = classes.slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
  const selector = `${el.tagName.toLowerCase()}${cls}`;
  try {
    const matches = document.querySelectorAll(selector);
    if (matches.length === 1) return selector;
  } catch {
    // skip invalid selector
  }
  return null;
}

function buildStructuralSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current && current !== document.documentElement && depth < 5) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) break;

    const siblings = [...parent.children].filter((c) => c.tagName === current!.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    } else {
      parts.unshift(tag);
    }

    if (parent.id) {
      parts.unshift(`#${CSS.escape(parent.id)}`);
      break;
    }

    current = parent;
    depth++;
  }

  return parts.join(' > ');
}

// ──────────────────────────────────────────────
// XPath generation
// ──────────────────────────────────────────────

export function getXPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;

    if (!parent) {
      parts.unshift(`/${tag}`);
      break;
    }

    const siblings = [...parent.children].filter((c) => c.tagName === current!.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}[${idx}]`);
    } else {
      parts.unshift(tag);
    }

    current = parent;
  }

  return '/' + parts.join('/');
}

// ──────────────────────────────────────────────
// Label resolution
// ──────────────────────────────────────────────

export function getLabel(el: Element): string | undefined {
  // aria-label
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;

  // associated <label> via for/id
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) return label.textContent?.trim();
  }

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labeller = document.getElementById(labelledBy);
    if (labeller) return labeller.textContent?.trim();
  }

  // parent label
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent?.trim();

  // preceding sibling or parent cell label in a form row
  const parent = el.parentElement;
  if (parent) {
    const labels = parent.querySelectorAll('label');
    if (labels.length === 1) return labels[0].textContent?.trim();
  }

  return undefined;
}

// ──────────────────────────────────────────────
// Visible text
// ──────────────────────────────────────────────

export function getVisibleText(el: Element): string {
  if ('value' in el) return (el as HTMLInputElement).value;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// ──────────────────────────────────────────────
// Container context
// ──────────────────────────────────────────────

function getContainerText(el: Element): string {
  const container = el.closest('form, section, article, [role="group"], fieldset, .field, .row') ?? el.parentElement;
  if (!container) return '';
  // Get only direct text nodes (not from the element itself)
  const text = [...container.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent?.trim())
    .filter(Boolean)
    .join(' ');
  return text.slice(0, 80);
}

// ──────────────────────────────────────────────
// Attributes extraction
// ──────────────────────────────────────────────

function getAttributes(el: Element): Record<string, string> {
  const relevant = ['id', 'name', 'type', 'placeholder', 'aria-label', 'role', 'data-testid', 'href', 'value', 'class'];
  const result: Record<string, string> = {};
  for (const attr of relevant) {
    const val = el.getAttribute(attr);
    if (val) result[attr] = val.slice(0, 200);
  }
  return result;
}

// ──────────────────────────────────────────────
// Element interactability check
// ──────────────────────────────────────────────

export function isInteractable(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}
