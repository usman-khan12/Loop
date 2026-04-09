import type { TargetDescriptor } from '../shared/types';

/** Extract visible text from an element */
export function extractText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Extract form value from an element */
export function extractValue(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  if (el instanceof HTMLSelectElement) {
    return el.options[el.selectedIndex]?.text ?? el.value;
  }
  return extractText(el);
}

/** Extract all text fields from a table row */
export function extractTableRow(
  rowEl: Element,
  fieldMap?: Record<string, number>
): Record<string, string> {
  const cells = [...rowEl.querySelectorAll('td, th')];
  const result: Record<string, string> = {};

  if (fieldMap) {
    for (const [fieldName, colIndex] of Object.entries(fieldMap)) {
      const cell = cells[colIndex];
      if (cell) result[fieldName] = extractText(cell);
    }
  } else {
    cells.forEach((cell, i) => {
      result[`col_${i}`] = extractText(cell);
    });
  }

  return result;
}

/** Resolve all extraction variables from a batch row */
export function extractBatchRow(
  rowSelector: string,
  rowIndex: number,
  fieldMap: Record<string, string>
): Record<string, string> {
  const rows = [...document.querySelectorAll(rowSelector)];
  const row = rows[rowIndex];
  if (!row) return {};

  const result: Record<string, string> = {};
  for (const [varName, fieldSelector] of Object.entries(fieldMap)) {
    const el = row.querySelector(fieldSelector) ?? row;
    result[varName] = extractText(el);
  }
  return result;
}

/** Count rows matching a selector */
export function countRows(rowSelector: string): number {
  return document.querySelectorAll(rowSelector).length;
}

/** Extract value from a descriptor target for verification */
export function extractFromDescriptor(target: TargetDescriptor): string {
  const el = document.querySelector(target.selectorCandidates[0] ?? '');
  if (!el) return '';
  return extractValue(el);
}
