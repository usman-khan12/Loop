/**
 * Background Service Worker — Entry Point
 * The central hub for all inter-context communication.
 */

import type {
  Message,
  RawRecordedEvent,
  Workflow,
  BackgroundState,
} from '../shared/types';
import {
  buildWorkflow,
  mergeConsecutiveFills,
} from './workflowBuilder';
import {
  tabRefMap,
  registerTab,
  clearTabRefMap,
  ensureContentScript,
  markTabInjected,
  clearInjectedTabs,
  createAutomationWindow,
  closeAutomationWindow,
  getAutomationTabIds,
} from './tabManager';
import {
  createRun,
  executeWorkflow,
  getCurrentRun,
  pauseRun,
  resumeRun,
  stopRun,
} from './workflowEngine';
import {
  getWorkflows,
  saveWorkflow,
  deleteWorkflow,
  saveRun,
  getRuns,
  getSettings,
} from '../shared/storage';

// ──────────────────────────────────────────────
// Runtime state
// ──────────────────────────────────────────────

const state: BackgroundState = {
  recordingState: 'idle',
  recordedEvents: [],
  currentRun: null,
  automationWindowId: null,
  automationTabMap: {},
};



// ──────────────────────────────────────────────
// Install / startup
// ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  // Open side panel on extension icon click
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log('[Loop] Extension installed');
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// ──────────────────────────────────────────────
// Tab tracking (for recording)
// ──────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (state.recordingState !== 'recording') return;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome://')) return;

    const ref = registerTab(tabId, tab.url, tab.title ?? tab.url);
    // Inject content script into newly activated tab
    await ensureContentScript(tabId);

    // Emit a focus_tab event
    const event: RawRecordedEvent = {
      id: `ev_tab_${tabId}_${Date.now()}`,
      type: 'focus_tab',
      timestamp: new Date().toISOString(),
      tabId,
      tabRef: ref,
      url: tab.url,
    };
    state.recordedEvents.push(event);
    broadcastRecordingEvent(event);
  } catch (err) {
    console.warn('[Loop] Tab tracking error:', err);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (state.recordingState !== 'recording') return;
  if (info.status !== 'complete') return;
  if (!tab.url || tab.url.startsWith('chrome://')) return;

  // Update registration
  registerTab(tabId, tab.url, tab.title ?? tab.url);
  await ensureContentScript(tabId);
});

// ──────────────────────────────────────────────
// Message hub
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err: unknown) => {
      console.error('[Loop] Message handler error:', err);
      sendResponse({ success: false, error: String(err) });
    });
  return true;
});

async function handleMessage(
  msg: Message,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (msg.type) {
    // ── Recording ──
    case 'START_RECORDING':
      return await startRecording(sender);

    case 'STOP_RECORDING':
      return await stopRecordingAndSave();

    case 'RECORDING_EVENT':
      return handleRecordingEvent(msg.payload as RawRecordedEvent, sender);

    case 'VARIABLE_MARKED':
      return handleVariableMarked(msg.payload as {
        varName: string;
        value: string;
        target: RawRecordedEvent['target'];
      }, sender);

    // ── State ──
    case 'GET_STATE': {
      const workflows = await getWorkflows();
      const runs = await getRuns();
      const settings = await getSettings();
      return {
        ...state,
        workflows,
        runs,
        settings,
        currentRun: getCurrentRun() ?? state.currentRun,
      };
    }

    // ── Workflow CRUD ──
    case 'SAVE_WORKFLOW' as Message['type']: {
      const wf = (msg as { payload: Workflow }).payload;
      await saveWorkflow(wf);
      return { success: true };
    }

    case 'DELETE_WORKFLOW' as Message['type']: {
      const { id } = msg.payload as { id: string };
      await deleteWorkflow(id);
      return { success: true };
    }

    // ── Run control ──
    case 'RUN_WORKFLOW': {
      const { workflow } = msg.payload as { workflow: Workflow };
      return await startWorkflowRun(workflow);
    }

    case 'PAUSE_RUN':
      pauseRun();
      return { success: true };

    case 'RESUME_RUN':
      resumeRun();
      return { success: true };

    case 'STOP_RUN':
      stopRun();
      await closeAutomationWindow();
      return { success: true };

    // ── Content script ready ──
    case 'CONTENT_SCRIPT_READY':
      if (sender.tab?.id) {
        markTabInjected(sender.tab.id);
      }
      return null;

    default:
      return null;
  }
}

// ──────────────────────────────────────────────
// Recording
// ──────────────────────────────────────────────

async function startRecording(_sender: chrome.runtime.MessageSender): Promise<{ success: boolean }> {
  state.recordingState = 'recording';
  state.recordedEvents = [];
  clearTabRefMap();
  clearInjectedTabs();

  // Inject into the current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && tab.url && !tab.url.startsWith('chrome://')) {
    registerTab(tab.id, tab.url, tab.title ?? tab.url);
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING', source: 'background' });
  }

  broadcastRecordingState();
  return { success: true };
}

async function stopRecordingAndSave(): Promise<{ success: boolean; workflow: Workflow }> {
  state.recordingState = 'processing';
  broadcastRecordingState();

  // Stop recording in all registered tabs
  for (const tabIdStr of Object.keys(tabRefMap)) {
    const tabId = parseInt(tabIdStr, 10);
    chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING', source: 'background' }).catch(() => {});
  }

  // Merge consecutive fills
  const events = state.recordedEvents;
  const workflow = buildWorkflow(events, tabRefMap);
  workflow.steps = mergeConsecutiveFills(workflow.steps);

  await saveWorkflow(workflow);

  state.recordingState = 'idle';
  state.recordedEvents = [];
  broadcastRecordingState();

  return { success: true, workflow };
}

function handleRecordingEvent(
  event: RawRecordedEvent,
  sender: chrome.runtime.MessageSender
): null {
  if (state.recordingState !== 'recording') return null;

  // Fill in tabId from sender
  if (sender.tab?.id) {
    event.tabId = sender.tab.id;
    const info = tabRefMap[sender.tab.id];
    if (info) event.tabRef = info.ref;
  }

  state.recordedEvents.push(event);
  broadcastRecordingEvent(event);
  return null;
}

function handleVariableMarked(
  payload: { varName: string; value: string; target: RawRecordedEvent['target'] },
  sender: chrome.runtime.MessageSender
): null {
  const tabId = sender.tab?.id;
  const event: RawRecordedEvent = {
    id: `ev_var_${Date.now()}`,
    type: 'extract_text',
    timestamp: new Date().toISOString(),
    tabId: tabId ?? 0,
    tabRef: tabId ? tabRefMap[tabId]?.ref : undefined,
    url: sender.tab?.url ?? '',
    target: payload.target,
    saveAs: payload.varName,
    value: payload.value,
  };
  state.recordedEvents.push(event);
  broadcastRecordingEvent(event);
  return null;
}

// ──────────────────────────────────────────────
// Run workflow
// ──────────────────────────────────────────────

async function startWorkflowRun(workflow: Workflow): Promise<{ success: boolean; runId: string }> {
  // Create automation window
  await createAutomationWindow(workflow.tabRefs);

  const run = createRun(workflow);
  // Map tabRefs for the run
  const tabMap = getAutomationTabIds();
  Object.assign(run, { automationTabMap: { ...tabMap } });

  // Execute async (don't await — return runId immediately)
  executeWorkflow(workflow, run).then(async (completedRun) => {
    await saveRun(completedRun);
    const settings = await getSettings();
    if (settings.autoCloseAutomationWindow) {
      await closeAutomationWindow();
    }
  });

  return { success: true, runId: run.id };
}

// ──────────────────────────────────────────────
// Broadcast helpers
// ──────────────────────────────────────────────

function broadcastRecordingState(): void {
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    source: 'background',
    payload: {
      recordingState: state.recordingState,
      eventCount: state.recordedEvents.length,
    },
  }).catch(() => {});
}

function broadcastRecordingEvent(event: RawRecordedEvent): void {
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    source: 'background',
    payload: {
      recordingEvent: event,
      eventCount: state.recordedEvents.length,
    },
  }).catch(() => {});
}
