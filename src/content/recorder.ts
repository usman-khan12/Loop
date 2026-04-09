import type { RawRecordedEvent, StepType, TargetDescriptor } from '../shared/types';
import { buildTargetDescriptor, isInteractable } from './domUtils';
import { generateId } from '../shared/utils';

let isRecording = false;
const pendingEvents: RawRecordedEvent[] = [];
let lastFillTarget: Element | null = null;
let lastFillEventId: string | null = null;



// ──────────────────────────────────────────────
// Start / Stop
// ──────────────────────────────────────────────

export function startRecording(): void {
  if (isRecording) return;
  isRecording = true;
  addListeners();
  console.log('[Loop Recorder] Started');
}

export function stopRecording(): RawRecordedEvent[] {
  if (!isRecording) return [];
  isRecording = false;
  removeListeners();
  console.log('[Loop Recorder] Stopped, events:', pendingEvents.length);
  const events = [...pendingEvents];
  pendingEvents.length = 0;
  lastFillTarget = null;
  lastFillEventId = null;
  return events;
}

// ──────────────────────────────────────────────
// Event listeners
// ──────────────────────────────────────────────

function addListeners(): void {
  document.addEventListener('click', handleClick, { capture: true, passive: true });
  document.addEventListener('beforeinput', handleBeforeInput, { capture: true, passive: true });
  document.addEventListener('input', handleInput, { capture: true, passive: true });
  document.addEventListener('change', handleChange, { capture: true, passive: true });
  document.addEventListener('submit', handleSubmit, { capture: true, passive: true });
  document.addEventListener('copy', handleCopy, { capture: true, passive: true });
  document.addEventListener('paste', handlePaste, { capture: true, passive: true });
}

function removeListeners(): void {
  document.removeEventListener('click', handleClick, { capture: true });
  document.removeEventListener('beforeinput', handleBeforeInput, { capture: true });
  document.removeEventListener('input', handleInput, { capture: true });
  document.removeEventListener('change', handleChange, { capture: true });
  document.removeEventListener('submit', handleSubmit, { capture: true });
  document.removeEventListener('copy', handleCopy, { capture: true });
  document.removeEventListener('paste', handlePaste, { capture: true });
}

// ──────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────

function handleClick(e: MouseEvent): void {
  if (!isRecording) return;
  const el = getRecordableClickTarget(e.target);
  if (!el || !isInteractable(el)) return;

  const tag = el.tagName.toLowerCase();
  if (tag === 'html' || tag === 'body') return;

  // Text-like inputs are handled by input/change events instead of clicks.
  if (isTextEntryElement(el)) return;

  const target = buildTargetDescriptor(el);
  const event = makeEvent('click', target);
  emitEvent(event);
}

function handleInput(e: Event): void {
  if (!isRecording) return;
  const descriptor = getFillDescriptor(e.target);
  if (!descriptor) return;
  const { element, target, value } = descriptor;

  // Merge rapid typing into same element
  if (element === lastFillTarget && lastFillEventId) {
    const existing = pendingEvents.find((ev) => ev.id === lastFillEventId);
    if (existing) {
      existing.value = value;
      notifyBackground(existing);
      return;
    }
  }

  const event = makeEvent('fill_input', target, value);
  lastFillTarget = element;
  lastFillEventId = event.id;
  emitEvent(event);
}

function handleBeforeInput(e: InputEvent): void {
  if (!isRecording) return;
  if (!e.inputType.startsWith('insertFromPaste')) return;

  queueMicrotask(() => {
    handleInput(e);
  });
}

function handleChange(e: Event): void {
  if (!isRecording) return;
  const target = e.target;
  if (!(target instanceof Element)) return;

  if (target instanceof HTMLSelectElement) {
    const descriptor = buildTargetDescriptor(target);
    const event = makeEvent('select_option', descriptor, target.value);
    emitEvent(event);
    return;
  }

  if (target instanceof HTMLInputElement) {
    const type = target.type.toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      const descriptor = buildTargetDescriptor(target);
      const event = makeEvent('click', descriptor, target.checked ? 'checked' : 'unchecked');
      emitEvent(event);
    }
  }
}

function handleSubmit(e: SubmitEvent): void {
  if (!isRecording) return;
  const form = e.target as HTMLFormElement;
  if (!form) return;

  const submitBtn =
    form.querySelector<Element>('[type="submit"]') ??
    form.querySelector<Element>('button:not([type])');
  const target = submitBtn
    ? buildTargetDescriptor(submitBtn)
    : buildTargetDescriptor(form);

  const event = makeEvent('submit_form', target);
  emitEvent(event);
}

/**
 * Copy handler — when the user copies text, we record an extract_text event.
 * The workflowBuilder will later match this against fill_input events on other
 * tabs that have the same value, automatically linking them via a variable.
 */
function handleCopy(_e: ClipboardEvent): void {
  if (!isRecording) return;

  const { text, sourceEl } = getCopyContext();
  if (!text || text.length < 2) return;

  const target = sourceEl instanceof Element
    ? buildTargetDescriptor(sourceEl)
    : null;

  // Emit extract_text event — the variable name will be inferred later
  const event: RawRecordedEvent = {
    id: generateId('ev'),
    type: 'extract_text',
    timestamp: new Date().toISOString(),
    tabId: 0, // filled in by background
    url: window.location.href,
    target: target ?? undefined,
    value: text,
    saveAs: undefined, // assigned by workflowBuilder
  };
  emitEvent(event);
}

function handlePaste(e: ClipboardEvent): void {
  if (!isRecording) return;

  const pastedText = e.clipboardData?.getData('text/plain').trim() ?? '';
  if (!pastedText) return;

  queueMicrotask(() => {
    const descriptor = getFillDescriptor(e.target);
    if (!descriptor) return;

    const { target, value } = descriptor;
    if (!value) return;

    const event = makeEvent('fill_input', target, value);
    emitEvent(event);
  });
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeEvent(
  type: StepType,
  target: TargetDescriptor,
  value?: string
): RawRecordedEvent {
  return {
    id: generateId('ev'),
    type,
    timestamp: new Date().toISOString(),
    tabId: 0,
    url: window.location.href,
    target,
    value,
  };
}

function emitEvent(event: RawRecordedEvent): void {
  pendingEvents.push(event);
  notifyBackground(event);
}

function notifyBackground(event: RawRecordedEvent): void {
  chrome.runtime.sendMessage({
    type: 'RECORDING_EVENT',
    source: 'content',
    payload: event,
  }).catch(() => {});
}

function getRecordableClickTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;

  return target.closest(
    [
      'button',
      'a[href]',
      '[role="button"]',
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="checkbox"]',
      'input[type="radio"]',
      'label',
      'summary',
    ].join(', ')
  ) ?? target;
}

function isTextEntryElement(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return true;
  if (isContentEditableElement(el)) return true;
  if (!(el instanceof HTMLInputElement)) return false;

  const type = el.type.toLowerCase();
  return !['button', 'submit', 'checkbox', 'radio', 'range', 'color', 'file'].includes(type);
}

function getCopyContext(): { text: string; sourceEl: Element | null } {
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() ?? '';
  if (selectedText) {
    const anchorNode = selection?.anchorNode;
    const sourceEl = anchorNode?.nodeType === Node.TEXT_NODE
      ? anchorNode.parentElement
      : anchorNode instanceof Element
        ? anchorNode
        : null;

    return { text: selectedText, sourceEl };
  }

  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement
  ) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    const text = active.value.slice(start, end).trim();
    return { text, sourceEl: active };
  }

  return { text: '', sourceEl: null };
}

function getFillDescriptor(target: EventTarget | null): {
  element: Element;
  target: TargetDescriptor;
  value: string;
} | null {
  if (!(target instanceof Element)) return null;

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const type = target.type?.toLowerCase();
    if (type === 'password' || type === 'hidden' || type === 'checkbox' || type === 'radio') {
      return null;
    }

    return {
      element: target,
      target: buildTargetDescriptor(target),
      value: target.value,
    };
  }

  const editable = target.closest('[contenteditable="true"]');
  if (editable instanceof Element) {
    return {
      element: editable,
      target: buildTargetDescriptor(editable),
      value: editable.textContent?.trim() ?? '',
    };
  }

  return null;
}

function isContentEditableElement(el: Element): boolean {
  return el.getAttribute('contenteditable') === 'true' || (el as HTMLElement).isContentEditable;
}
