import type { TargetDescriptor } from '../shared/types';

// ──────────────────────────────────────────────
// Resolve an element from a TargetDescriptor
// Returns the best matching element or null
// ──────────────────────────────────────────────

export function resolveTarget(target: TargetDescriptor): Element | null {
  const strategies: Array<() => Element | null> = [
    () => trySelectorCandidates(target.selectorCandidates),
    () => tryXPathCandidates(target.xpathCandidates),
    () => tryLabelBased(target),
    () => tryAttributeBased(target),
    () => tryTextBased(target),
    () => tryContainerScoped(target),
  ];

  for (const strategy of strategies) {
    const el = strategy();
    if (el && isVisible(el)) return el;
  }

  return null;
}

// ──────────────────────────────────────────────
// Strategy 1: CSS selector candidates
// ──────────────────────────────────────────────

function trySelectorCandidates(candidates: string[]): Element | null {
  for (const selector of candidates) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch {
      // invalid selector, skip
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// Strategy 2: XPath candidates
// ──────────────────────────────────────────────

function tryXPathCandidates(candidates: string[]): Element | null {
  for (const xpath of candidates) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const el = result.singleNodeValue;
      if (el instanceof Element) return el;
    } catch {
      // invalid xpath, skip
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// Strategy 3: Label-based lookup
// ──────────────────────────────────────────────

function tryLabelBased(target: TargetDescriptor): Element | null {
  const labelText = target.label ?? target.ariaLabel;
  if (!labelText) return null;

  // Try aria-label match
  const byAria = document.querySelector(`[aria-label="${labelText}"]`);
  if (byAria) return byAria;

  // Try <label> for association
  const labels = [...document.querySelectorAll('label')];
  const matchingLabel = labels.find(
    (l) => l.textContent?.trim().toLowerCase() === labelText.toLowerCase()
  );
  if (matchingLabel) {
    const forAttr = matchingLabel.getAttribute('for');
    if (forAttr) {
      const el = document.getElementById(forAttr);
      if (el) return el;
    }
    // label wrapping input
    const inner = matchingLabel.querySelector('input, select, textarea');
    if (inner) return inner;
  }

  // Try placeholder match for inputs
  if (target.placeholder) {
    const byPh = document.querySelector(`[placeholder="${target.placeholder}"]`);
    if (byPh) return byPh;
  }

  return null;
}

// ──────────────────────────────────────────────
// Strategy 4: Text content match (buttons/links)
// ──────────────────────────────────────────────

function tryTextBased(target: TargetDescriptor): Element | null {
  if (!target.text) return null;
  const searchText = normalize(target.text);
  if (!searchText) return null;

  const selector = target.kind === 'button' || target.kind === 'link'
    ? 'button, a, [role="button"], input[type="submit"], input[type="button"], summary, label'
    : `${target.tagName}, [role="${target.kind}"]`;

  const candidates = [...document.querySelectorAll(selector)];

  const exact = candidates.find((el) => getComparableText(el) === searchText);
  if (exact) return exact;

  return candidates.find((el) => getComparableText(el).includes(searchText)) ?? null;
}

function tryAttributeBased(target: TargetDescriptor): Element | null {
  const attrs = target.attributes;

  if (attrs.id) {
    const byId = document.getElementById(attrs.id);
    if (byId) return byId;
  }

  if (attrs['data-testid']) {
    const byTestId = document.querySelector(`[data-testid="${attrs['data-testid']}"]`);
    if (byTestId) return byTestId;
  }

  if (attrs.name) {
    const byName = document.querySelector(`${target.tagName}[name="${attrs.name}"]`);
    if (byName) return byName;
  }

  if (attrs.href) {
    const byHref = document.querySelector(`a[href="${attrs.href}"]`);
    if (byHref) return byHref;
  }

  return null;
}

function tryContainerScoped(target: TargetDescriptor): Element | null {
  const containerText = normalize(target.containerText);
  if (!containerText) return null;

  const containers = [
    ...document.querySelectorAll('form, section, article, [role="group"], fieldset, .field, .row'),
  ].filter((container) => normalize(container.textContent).includes(containerText));

  for (const container of containers) {
    const scoped = trySelectorCandidatesInRoot(target.selectorCandidates, container);
    if (scoped) return scoped;

    const candidates = container.querySelectorAll(target.tagName);
    for (const candidate of candidates) {
      if (matchesDescriptor(candidate, target)) return candidate;
    }
  }

  return null;
}

// ──────────────────────────────────────────────
// Visibility check
// ──────────────────────────────────────────────

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function trySelectorCandidatesInRoot(candidates: string[], root: ParentNode): Element | null {
  for (const selector of candidates) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      // invalid selector, skip
    }
  }
  return null;
}

function matchesDescriptor(candidate: Element, target: TargetDescriptor): boolean {
  const label = normalize(target.label ?? target.ariaLabel);
  const placeholder = normalize(target.placeholder);
  const text = normalize(target.text);
  const candidateText = getComparableText(candidate);

  if (label) {
    const aria = normalize(candidate.getAttribute('aria-label'));
    const id = candidate.getAttribute('id');
    const byLabel = id
      ? normalize(document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent)
      : '';
    if (aria === label || byLabel === label) return true;
  }

  if (placeholder && normalize(candidate.getAttribute('placeholder')) === placeholder) {
    return true;
  }

  if (text && candidateText === text) return true;

  return false;
}

function getComparableText(el: Element): string {
  if (el instanceof HTMLInputElement) {
    return normalize(el.value || el.getAttribute('value') || el.getAttribute('aria-label'));
  }

  return normalize(el.textContent ?? el.getAttribute('aria-label'));
}

function normalize(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
