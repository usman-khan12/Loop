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
  document.addEventListener('input', handleInput, { capture: true, passive: true });
  document.addEventListener('change', handleChange, { capture: true, passive: true });
  document.addEventListener('submit', handleSubmit, { capture: true, passive: true });
}

function removeListeners(): void {
  document.removeEventListener('click', handleClick, { capture: true });
  document.removeEventListener('input', handleInput, { capture: true });
  document.removeEventListener('change', handleChange, { capture: true });
  document.removeEventListener('submit', handleSubmit, { capture: true });
}

// ──────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────

function handleClick(e: MouseEvent): void {
  if (!isRecording) return;
  const el = e.target as Element;
  if (!el || !isInteractable(el)) return;

  // Skip clicks on extension UI (though content scripts don't see those)
  const tag = el.tagName.toLowerCase();
  if (tag === 'html' || tag === 'body') return;

  // Don't record clicks on inputs — those are handled by input/change events
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  const target = buildTargetDescriptor(el);
  const event = makeEvent('click', target);
  emitEvent(event);
}

function handleInput(e: Event): void {
  if (!isRecording) return;
  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!el) return;

  const tag = el.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return;

  // Sensitive input types to skip
  const type = (el as HTMLInputElement).type?.toLowerCase();
  if (type === 'password' || type === 'hidden') return;

  const target = buildTargetDescriptor(el);

  // Merge rapid typing into same element
  if (el === lastFillTarget && lastFillEventId) {
    const existing = pendingEvents.find((ev) => ev.id === lastFillEventId);
    if (existing) {
      existing.value = el.value;
      notifyBackground(existing);
      return;
    }
  }

  const event = makeEvent('fill_input', target, el.value);
  lastFillTarget = el;
  lastFillEventId = event.id;
  emitEvent(event);
}

function handleChange(e: Event): void {
  if (!isRecording) return;
  const el = e.target as HTMLSelectElement;
  if (el.tagName.toLowerCase() !== 'select') return;

  const target = buildTargetDescriptor(el);
  const event = makeEvent('select_option', target, el.value);
  emitEvent(event);
}

function handleSubmit(e: SubmitEvent): void {
  if (!isRecording) return;
  const form = e.target as HTMLFormElement;
  if (!form) return;

  // Find submit button if possible
  const submitBtn =
    form.querySelector<Element>('[type="submit"]') ??
    form.querySelector<Element>('button:not([type])');
  const target = submitBtn
    ? buildTargetDescriptor(submitBtn)
    : buildTargetDescriptor(form);

  const event = makeEvent('submit_form', target);
  emitEvent(event);
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
    tabId: 0, // filled in by background
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
  }).catch(() => {
    // background may not be listening yet, that's OK
  });
}
