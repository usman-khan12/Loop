/**
 * Variable Marker — "Mark as Variable" mode
 * Activated by the user via the side panel during recording.
 * User hovers over an element and clicks to save its value as a named variable.
 */

import { buildTargetDescriptor } from './domUtils';
import { extractText, extractValue } from './extraction';

type MarkerCallback = (varName: string, value: string, target: ReturnType<typeof buildTargetDescriptor>) => void;

let isActive = false;
let onMarked: MarkerCallback | null = null;

const HOVER_ID = '__loop_marker_hover__';
const PROMPT_ID = '__loop_marker_prompt__';

// ──────────────────────────────────────
// Activate
// ──────────────────────────────────────

export function activateMarkerMode(callback: MarkerCallback): void {
  if (isActive) return;
  isActive = true;
  onMarked = callback;
  showInstructions();
  document.addEventListener('mouseover', handleMouseOver, { passive: true });
  document.addEventListener('click', handleClick, { capture: true });
  document.addEventListener('keydown', handleKeyDown);
}

export function deactivateMarkerMode(): void {
  if (!isActive) return;
  isActive = false;
  onMarked = null;
  cleanup();
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('click', handleClick, { capture: true });
  document.removeEventListener('keydown', handleKeyDown);
}

// ──────────────────────────────────────
// Handlers
// ──────────────────────────────────────

function handleMouseOver(e: MouseEvent): void {
  const el = e.target as Element;
  if (!el || el.id === HOVER_ID || el.id === PROMPT_ID) return;
  if (el.closest(`#${PROMPT_ID}`)) return;


  const existing = document.getElementById(HOVER_ID);
  if (existing) existing.remove();

  const rect = el.getBoundingClientRect();
  const highlight = document.createElement('div');
  highlight.id = HOVER_ID;
  Object.assign(highlight.style, {
    position: 'fixed',
    top: `${rect.top - 2}px`,
    left: `${rect.left - 2}px`,
    width: `${rect.width + 4}px`,
    height: `${rect.height + 4}px`,
    border: '2px dashed #E890C0',
    borderRadius: '4px',
    background: 'rgba(232, 144, 192, 0.08)',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });
  document.body.appendChild(highlight);
}

function handleClick(e: MouseEvent): void {
  if (!isActive) return;

  const el = e.target as Element;
  if (!el) return;
  if (el.closest(`#${PROMPT_ID}`)) return; // clicking inside our prompt

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  showNamePrompt(el);
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    deactivateMarkerMode();
  }
}

// ──────────────────────────────────────
// Name prompt overlay
// ──────────────────────────────────────

function showNamePrompt(el: Element): void {
  const existing = document.getElementById(PROMPT_ID);
  if (existing) existing.remove();

  const previewValue = extractValue(el) || extractText(el);
  const rect = el.getBoundingClientRect();

  const prompt = document.createElement('div');
  prompt.id = PROMPT_ID;
  prompt.innerHTML = `
    <div style="
      background: white;
      border: 1px solid #E2E6F0;
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.12);
      font-family: 'Inter', sans-serif;
      min-width: 220px;
    ">
      <div style="font-size:12px;color:#6B7194;margin-bottom:4px;">Value preview</div>
      <div style="font-size:13px;color:#1A1D2E;font-weight:500;margin-bottom:12px;word-break:break-all;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${previewValue || '(empty)'}</div>
      <div style="font-size:12px;color:#6B7194;margin-bottom:4px;">Variable name</div>
      <input id="__loop_var_name__" placeholder="e.g. email" style="
        width:100%;padding:8px 10px;border:1px solid #E2E6F0;border-radius:6px;
        font-size:13px;font-family:inherit;margin-bottom:10px;outline:none;
      " />
      <div style="display:flex;gap:8px;">
        <button id="__loop_var_save__" style="
          flex:1;padding:8px;background:linear-gradient(135deg,#7EB6FF,#C4A3FF);
          color:white;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;
        ">Save Variable</button>
        <button id="__loop_var_cancel__" style="
          padding:8px 12px;background:#F0F2F8;color:#6B7194;border:none;
          border-radius:6px;font-size:13px;cursor:pointer;
        ">Cancel</button>
      </div>
    </div>
  `;

  Object.assign(prompt.style, {
    position: 'fixed',
    top: `${Math.min(rect.bottom + 8, window.innerHeight - 200)}px`,
    left: `${Math.min(rect.left, window.innerWidth - 260)}px`,
    zIndex: '2147483647',
  });

  document.body.appendChild(prompt);

  const input = document.getElementById('__loop_var_name__') as HTMLInputElement;
  const saveBtn = document.getElementById('__loop_var_save__')!;
  const cancelBtn = document.getElementById('__loop_var_cancel__')!;

  input.focus();

  saveBtn.addEventListener('click', () => {
    const varName = input.value.trim().replace(/\s+/g, '_').toLowerCase();
    if (!varName) {
      input.style.borderColor = '#EF4444';
      return;
    }
    const target = buildTargetDescriptor(el);
    onMarked?.(varName, previewValue, target);
    cleanup();
  });

  cancelBtn.addEventListener('click', cleanup);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') cleanup();
  });
}

function showInstructions(): void {
  const banner = document.createElement('div');
  banner.id = '__loop_marker_banner__';
  Object.assign(banner.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'linear-gradient(135deg, #7EB6FF, #C4A3FF)',
    color: 'white',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: 'Inter, sans-serif',
    fontWeight: '500',
    zIndex: '2147483647',
    boxShadow: '0 4px 16px rgba(91,155,247,0.3)',
    pointerEvents: 'none',
  });
  banner.textContent = '🎯 Hover and click an element to mark it as a variable. Press Esc to cancel.';
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 4000);
}

function cleanup(): void {
  document.getElementById(HOVER_ID)?.remove();
  document.getElementById(PROMPT_ID)?.remove();
  document.getElementById('__loop_marker_banner__')?.remove();
}
