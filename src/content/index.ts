/**
 * Content Script Entry Point
 * Injected dynamically via chrome.scripting.executeScript
 */

import { startRecording, stopRecording } from './recorder';
import { executeStep, highlightElement, clearHighlight } from './executor';
import { buildTargetDescriptor } from './domUtils';
import { resolveTarget } from './targetResolver';
import type { Message, WorkflowStep } from '../shared/types';

// Announce presence to background
chrome.runtime.sendMessage({
  type: 'CONTENT_SCRIPT_READY',
  source: 'content',
  payload: { url: window.location.href, tabId: null },
}).catch(() => {});

// ──────────────────────────────────────────────
// Message listener
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: String(err) });
  });
  return true;
});

async function handleMessage(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'START_RECORDING':
      startRecording();
      return { success: true };

    case 'STOP_RECORDING':
      return { success: true, events: stopRecording() };

    case 'EXECUTE_STEP': {
      const { step, variables } = msg.payload as {
        step: WorkflowStep;
        variables: Record<string, string>;
      };
      return await executeStep(step, variables);
    }

    case 'HIGHLIGHT_ELEMENT': {
      const { target } = msg.payload as { target: ReturnType<typeof buildTargetDescriptor> };
      const el = resolveTarget(target);
      if (el) highlightElement(el);
      return { success: !!el };
    }

    case 'CLEAR_HIGHLIGHT':
      clearHighlight();
      return { success: true };

    default:
      return null;
  }
}
