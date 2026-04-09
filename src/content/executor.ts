import type { WorkflowStep, TargetDescriptor } from '../shared/types';
import { resolveTarget as _resolveTarget } from './targetResolver';
import { extractText, extractValue } from './extraction';
import { POLL_INTERVAL, DEFAULT_TIMEOUT } from '../shared/constants';
import { resolveTemplate } from '../shared/utils';

// ──────────────────────────────────────────────
// Execute a single workflow step
// ──────────────────────────────────────────────

export async function executeStep(
  step: WorkflowStep,
  variables: Record<string, string>
): Promise<{ success: boolean; extractedValue?: string; error?: string }> {
  try {
    switch (step.type) {
      case 'click':
        return await execClick(step);

      case 'fill_input':
        return await execFillInput(step, variables);

      case 'select_option':
        return await execSelectOption(step, variables);

      case 'extract_text':
        return await execExtractText(step);

      case 'extract_value':
        return await execExtractValue(step);

      case 'submit_form':
        return await execSubmitForm(step);

      case 'wait_for_element':
        return await execWaitForElement(step);

      case 'wait_for_url':
        return execWaitForUrl(step);

      case 'assert_text_present':
        return execAssertTextPresent(step);

      case 'delay':
        return await execDelay(step);

      case 'open_url':
        window.location.href = step.url ?? '';
        return { success: true };

      case 'focus_tab':
        // handled by background — no-op in content script
        return { success: true };

      case 'save_variable':
        // handled by background
        return { success: true };

      default:
        return { success: false, error: `Unknown step type: ${(step as WorkflowStep).type}` };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ──────────────────────────────────────────────
// click
// ──────────────────────────────────────────────

async function execClick(step: WorkflowStep): Promise<{ success: boolean; error?: string }> {
  const el = findTarget(step.target);
  if (!el) return { success: false, error: 'Element not found' };

  highlightElement(el);
  await delay(80);

  // Try native click first
  if (el instanceof HTMLElement) {
    el.focus();
    el.click();
    return { success: true };
  }

  // Fallback: dispatch mouse events
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return { success: true };
}

// ──────────────────────────────────────────────
// fill_input
// ──────────────────────────────────────────────

async function execFillInput(
  step: WorkflowStep,
  variables: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const el = findTarget(step.target);
  if (!el) return { success: false, error: 'Input element not found' };

  highlightElement(el);
  const value = step.valueTemplate
    ? resolveTemplate(step.valueTemplate, variables)
    : step.value ?? '';

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    // Clear existing value
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));

    // Set new value
    el.value = value;

    // Fire events for React/Vue/Angular compatibility
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    // React synthetic event hack
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    return { success: true };
  }

  // contenteditable
  if (el.getAttribute('contenteditable') === 'true') {
    (el as HTMLElement).focus();
    (el as HTMLElement).textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { success: true };
  }

  return { success: false, error: 'Target is not a fillable input' };
}

// ──────────────────────────────────────────────
// select_option
// ──────────────────────────────────────────────

async function execSelectOption(
  step: WorkflowStep,
  variables: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const el = findTarget(step.target);
  if (!el || !(el instanceof HTMLSelectElement)) {
    return { success: false, error: 'Select element not found' };
  }

  const value = step.valueTemplate
    ? resolveTemplate(step.valueTemplate, variables)
    : step.value ?? '';
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true };
}

// ──────────────────────────────────────────────
// extract_text / extract_value
// ──────────────────────────────────────────────

async function execExtractText(
  step: WorkflowStep
): Promise<{ success: boolean; extractedValue?: string; error?: string }> {
  const el = findTarget(step.target);
  if (!el) return { success: false, error: 'Element not found for extraction' };

  const value = extractText(el);
  return { success: true, extractedValue: value };
}

async function execExtractValue(
  step: WorkflowStep
): Promise<{ success: boolean; extractedValue?: string; error?: string }> {
  const el = findTarget(step.target);
  if (!el) return { success: false, error: 'Element not found for extraction' };

  const value = extractValue(el);
  return { success: true, extractedValue: value };
}

// ──────────────────────────────────────────────
// submit_form
// ──────────────────────────────────────────────

async function execSubmitForm(
  step: WorkflowStep
): Promise<{ success: boolean; error?: string }> {
  // First try clicking the submit button via target
  if (step.target) {
    const el = findTarget(step.target);
    if (el && el instanceof HTMLElement) {
      highlightElement(el);
      await delay(100);
      el.click();
      return { success: true };
    }
  }

  // Fallback: find any submit button
  const submitBtn = document.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"], button:not([type])'
  );
  if (submitBtn) {
    highlightElement(submitBtn);
    await delay(100);
    submitBtn.click();
    return { success: true };
  }

  // Last resort: submit the form directly
  const form = document.querySelector('form');
  if (form) {
    form.submit();
    return { success: true };
  }

  return { success: false, error: 'No submit button or form found' };
}

// ──────────────────────────────────────────────
// wait_for_element
// ──────────────────────────────────────────────

async function execWaitForElement(
  step: WorkflowStep
): Promise<{ success: boolean; error?: string }> {
  const timeout = step.timeout ?? DEFAULT_TIMEOUT;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (step.target) {
      const el = findTarget(step.target);
      if (el) return { success: true };
    }
    await delay(POLL_INTERVAL);
  }

  return { success: false, error: 'Timeout waiting for element' };
}

// ──────────────────────────────────────────────
// wait_for_url
// ──────────────────────────────────────────────

function execWaitForUrl(step: WorkflowStep): { success: boolean; error?: string } {
  const url = step.url ?? '';
  if (window.location.href.includes(url)) {
    return { success: true };
  }
  return { success: false, error: `URL does not match: expected ${url}, got ${window.location.href}` };
}

// ──────────────────────────────────────────────
// assert_text_present
// ──────────────────────────────────────────────

function execAssertTextPresent(step: WorkflowStep): { success: boolean; error?: string } {
  const text = step.value ?? '';
  if (document.body.textContent?.includes(text)) {
    return { success: true };
  }
  return { success: false, error: `Text not found on page: "${text}"` };
}

// ──────────────────────────────────────────────
// delay
// ──────────────────────────────────────────────

async function execDelay(step: WorkflowStep): Promise<{ success: boolean }> {
  const ms = parseInt(step.value ?? '500', 10);
  await delay(ms);
  return { success: true };
}

// ──────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────

function findTarget(target?: TargetDescriptor): Element | null {
  if (!target) return null;
  return _resolveTarget(target);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ──────────────────────────────────────────────
// Element highlight (visual feedback during replay)
// ──────────────────────────────────────────────

const HIGHLIGHT_ID = '__loop_highlight__';

export function highlightElement(el: Element): void {
  clearHighlight();

  const rect = el.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.id = HIGHLIGHT_ID;

  Object.assign(overlay.style, {
    position: 'fixed',
    top: `${rect.top - 3}px`,
    left: `${rect.left - 3}px`,
    width: `${rect.width + 6}px`,
    height: `${rect.height + 6}px`,
    border: '2px solid #5B9BF7',
    borderRadius: '4px',
    background: 'rgba(91, 155, 247, 0.08)',
    pointerEvents: 'none',
    zIndex: '2147483647',
    boxShadow: '0 0 0 4px rgba(91, 155, 247, 0.15)',
    transition: 'all 0.15s ease',
  });

  document.body.appendChild(overlay);
  setTimeout(clearHighlight, 1500);
}

export function clearHighlight(): void {
  const existing = document.getElementById(HIGHLIGHT_ID);
  if (existing) existing.remove();
}
