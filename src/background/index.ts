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

const trackedTabUrls = new Map<number, string>();
const pendingCreatedTabIds = new Set<number>();



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
    if (!isRecordableUrl(tab.url)) return;

    const ref = ensureTabRegistered(tabId, tab.url, tab.title ?? tab.url);
    await startRecordingInTab(tabId);

    // Emit a focus_tab event
    recordBackgroundEvent({
      id: `ev_tab_${tabId}_${Date.now()}`,
      type: 'focus_tab',
      timestamp: new Date().toISOString(),
      tabId,
      tabRef: ref,
      url: tab.url,
    });
  } catch (err) {
    console.warn('[Loop] Tab tracking error:', err);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (state.recordingState !== 'recording' || !tab.id) return;
  pendingCreatedTabIds.add(tab.id);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (state.recordingState !== 'recording') return;
  if (info.status !== 'complete') return;
  if (!isRecordableUrl(tab.url)) return;

  ensureTabRegistered(tabId, tab.url, tab.title ?? tab.url);

  await startRecordingInTab(tabId);
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (state.recordingState !== 'recording') return;
  if (details.frameId !== 0) return;
  if (!isRecordableUrl(details.url)) return;

  try {
    const tab = await chrome.tabs.get(details.tabId);
    const previousUrl = trackedTabUrls.get(details.tabId);
    const isNewTab = pendingCreatedTabIds.has(details.tabId) || !tabRefMap[details.tabId];
    const ref = ensureTabRegistered(details.tabId, details.url, tab.title ?? details.url);

    if (isNewTab || previousUrl !== details.url) {
      recordBackgroundEvent({
        id: `ev_nav_${details.tabId}_${Date.now()}`,
        type: 'open_url',
        timestamp: new Date().toISOString(),
        tabId: details.tabId,
        tabRef: ref,
        url: details.url,
      });
    }

    trackedTabUrls.set(details.tabId, details.url);
    pendingCreatedTabIds.delete(details.tabId);
  } catch (err) {
    console.warn('[Loop] Navigation tracking error:', err);
  }
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
  trackedTabUrls.clear();
  pendingCreatedTabIds.clear();

  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of tabs) {
    if (!tab.id || !isRecordableUrl(tab.url)) continue;
    ensureTabRegistered(tab.id, tab.url, tab.title ?? tab.url);
    trackedTabUrls.set(tab.id, tab.url);
    await startRecordingInTab(tab.id);
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
  trackedTabUrls.clear();
  pendingCreatedTabIds.clear();
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
    if (sender.tab.url && isRecordableUrl(sender.tab.url)) {
      event.tabRef = ensureTabRegistered(
        sender.tab.id,
        sender.tab.url,
        sender.tab.title ?? sender.tab.url
      );
      trackedTabUrls.set(sender.tab.id, sender.tab.url);
    }
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

async function startWorkflowRun(workflow: Workflow): Promise<{ success: boolean; runId: string; run: ReturnType<typeof createRun> }> {
  // Create automation window
  await createAutomationWindow(workflow.tabRefs);

  const run = createRun(workflow);
  state.currentRun = run;
  // Map tabRefs for the run
  const tabMap = getAutomationTabIds();
  Object.assign(run, { automationTabMap: { ...tabMap } });

  // Execute async (don't await — return runId immediately)
  executeWorkflow(workflow, run).then(async (completedRun) => {
    state.currentRun = completedRun;
    await saveRun(completedRun);
    const settings = await getSettings();
    if (settings.autoCloseAutomationWindow) {
      await closeAutomationWindow();
    }
  });

  return { success: true, runId: run.id, run };
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

function isRecordableUrl(url?: string): url is string {
  return Boolean(
    url &&
    (url.startsWith('http://') || url.startsWith('https://'))
  );
}

function ensureTabRegistered(tabId: number, url: string, title: string): string {
  const existing = tabRefMap[tabId];
  if (existing) {
    return existing.ref;
  }

  return registerTab(tabId, url, title);
}

async function startRecordingInTab(tabId: number): Promise<void> {
  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: 'START_RECORDING',
    source: 'background',
  }).catch(() => {});
}

function recordBackgroundEvent(event: RawRecordedEvent): void {
  state.recordedEvents.push(event);
  broadcastRecordingEvent(event);
}
