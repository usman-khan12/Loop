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
    () => tryTextBased(target),
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
  const searchText = target.text.toLowerCase().trim();

  const candidates = [
    ...document.querySelectorAll('button, a, [role="button"], input[type="submit"]'),
  ];

  return (
    candidates.find(
      (el) => el.textContent?.toLowerCase().trim() === searchText
    ) ?? null
  );
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
