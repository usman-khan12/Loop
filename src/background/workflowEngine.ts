import type { Workflow, Run, WorkflowStep, RunLog } from '../shared/types';
import {
  ensureContentScript,
  focusTab,
  openTabUrl,
  waitForTabLoad,
  createAutomationTab,
  getAutomationTabIds,
  getAutomationWindowId,
} from './tabManager';
import { saveRun } from '../shared/storage';
import { generateId, resolveTemplate, sleep } from '../shared/utils';
import { RETRY_COUNT, STEP_DELAY } from '../shared/constants';

// ──────────────────────────────────────────────
// Broadcast state update to side panel
// ──────────────────────────────────────────────

function broadcastState(run: Run): void {
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    source: 'background',
    payload: { currentRun: run },
  }).catch(() => {});
}

// ──────────────────────────────────────────────
// Create a new Run
// ──────────────────────────────────────────────

export function createRun(workflow: Workflow): Run {
  return {
    id: generateId('run'),
    workflowId: workflow.id,
    status: 'idle',
    startedAt: new Date().toISOString(),
    currentStepIndex: 0,
    variables: {},
    logs: [],
  };
}

// ──────────────────────────────────────────────
// Main execution engine
// ──────────────────────────────────────────────

let currentRun: Run | null = null;
let isPaused = false;
let isStopped = false;

export function getCurrentRun(): Run | null {
  return currentRun;
}

export async function executeWorkflow(
  workflow: Workflow,
  run: Run
): Promise<Run> {
  currentRun = run;
  isPaused = false;
  isStopped = false;

  run.status = 'running';
  run.startedAt = new Date().toISOString();
  broadcastState(run);

  try {
    for (let i = 0; i < workflow.steps.length; i++) {
      // Check for stop signal
      if (isStopped) {
        run.status = 'failed';
        appendLog(run, 'step_0', 'warn', 'Execution stopped by user');
        break;
      }

      // Wait while paused
      while (isPaused && !isStopped) {
        await sleep(300);
      }
      if (isStopped) break;

      const step = workflow.steps[i];
      run.currentStepIndex = i;
      broadcastState(run);

      const result = await executeStep(workflow, run, step);

      if (!result.success) {
        run.status = 'failed';
        run.finishedAt = new Date().toISOString();
        broadcastState(run);
        await saveRun(run);
        return run;
      }

      await sleep(STEP_DELAY);
    }

    if (!isStopped && run.status !== 'failed') {
      run.status = 'completed';
      run.finishedAt = new Date().toISOString();
      appendLog(run, 'done', 'success', '✅ Workflow completed successfully');
      broadcastState(run);
      await saveRun(run);
    }
  } catch (err) {
    run.status = 'failed';
    run.finishedAt = new Date().toISOString();
    appendLog(run, 'err', 'error', `Unexpected error: ${String(err)}`);
    broadcastState(run);
    await saveRun(run);
  }

  currentRun = null;
  return run;
}

// ──────────────────────────────────────────────
// Execute a single step with retry
// ──────────────────────────────────────────────

async function executeStep(
  workflow: Workflow,
  run: Run,
  step: WorkflowStep
): Promise<{ success: boolean }> {
  appendLog(run, step.id, 'info', `▶ ${step.description ?? step.type}`);
  broadcastState(run);

  // Special handling for steps that don't need a content script
  if (step.type === 'focus_tab') {
    return await handleFocusTab(run, step, workflow);
  }

  if (step.type === 'open_url') {
    return await handleOpenUrl(run, step, workflow);
  }

  if (step.type === 'delay') {
    const ms = parseInt(step.value ?? '500', 10);
    await sleep(ms);
    appendLog(run, step.id, 'success', `Delayed ${ms}ms`);
    return { success: true };
  }

  if (step.type === 'save_variable') {
    if (step.saveAs && step.value) {
      run.variables[step.saveAs] = resolveTemplate(step.value, run.variables);
      appendLog(run, step.id, 'success', `Saved {{${step.saveAs}}} = "${run.variables[step.saveAs]}"`);
    }
    return { success: true };
  }

  // Steps that need content script execution
  const tabId = getTabIdForStep(step, run);
  if (tabId === null) {
    appendLog(run, step.id, 'error', `No tab found for step ${step.id} (tabRef: ${step.tabRef})`);
    run.status = 'paused';
    broadcastState(run);
    return { success: false };
  }

  // Retry loop
  let lastError = '';
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      await ensureContentScript(tabId);
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_STEP',
        source: 'background',
        payload: { step, variables: run.variables },
      }) as { success: boolean; extractedValue?: string; error?: string } | null;

      if (!result) {
        lastError = 'No response from content script';
        await sleep(500);
        continue;
      }

      if (result.success) {
        // Store extracted value
        if (step.saveAs && result.extractedValue !== undefined) {
          run.variables[step.saveAs] = result.extractedValue;
          appendLog(
            run, step.id, 'success',
            `✅ ${step.description ?? step.type} — saved {{${step.saveAs}}} = "${result.extractedValue}"`
          );
        } else {
          appendLog(run, step.id, 'success', `✅ ${step.description ?? step.type}`);
        }
        broadcastState(run);
        await saveRun(run);
        return { success: true };
      }

      lastError = result.error ?? 'Unknown error';
      appendLog(run, step.id, 'warn', `Attempt ${attempt + 1} failed: ${lastError}`);
      await sleep(600);

    } catch (err) {
      lastError = String(err);
      appendLog(run, step.id, 'warn', `Attempt ${attempt + 1} exception: ${lastError}`);
      await sleep(600);
    }
  }

  appendLog(run, step.id, 'error', `❌ Step failed after ${RETRY_COUNT + 1} attempts: ${lastError}`);
  run.status = 'paused';
  broadcastState(run);
  await saveRun(run);
  return { success: false };
}

// ──────────────────────────────────────────────
// Tab step handlers
// ──────────────────────────────────────────────

async function handleFocusTab(
  run: Run,
  step: WorkflowStep,
  workflow: Workflow
): Promise<{ success: boolean }> {
  const tabRef = step.tabRef ?? '';
  const tabIds = getAutomationTabIds();
  const tabId = tabIds[tabRef];

  if (!tabId) {
    const refInfo = workflow.tabRefs[tabRef];
    if (refInfo) {
      const createdTabId = await createAutomationTab(tabRef, refInfo.url, true);
      if (createdTabId) {
        await focusTab(createdTabId);
        appendLog(run, step.id, 'success', `✅ Opened and focused tab: ${workflow.tabRefs[tabRef]?.title ?? tabRef}`);
        return { success: true };
      }
    }
    appendLog(run, step.id, 'warn', `Tab ref "${tabRef}" not found, skipping`);
    return { success: true };
  }

  await focusTab(tabId);
  appendLog(run, step.id, 'success', `✅ Focused tab: ${workflow.tabRefs[tabRef]?.title ?? tabRef}`);
  return { success: true };
}

async function handleOpenUrl(
  run: Run,
  step: WorkflowStep,
  workflow: Workflow
): Promise<{ success: boolean }> {
  const tabRef = step.tabRef ?? '';
  const tabIds = getAutomationTabIds();
  const tabId = tabIds[tabRef];
  const url = step.url ?? workflow.tabRefs[tabRef]?.url ?? '';

  if (!url) {
    appendLog(run, step.id, 'warn', 'No URL for open_url step, skipping');
    return { success: true };
  }

  if (tabId) {
    await openTabUrl(tabId, url);
    await ensureContentScript(tabId);
    appendLog(run, step.id, 'success', `✅ Navigated to ${url}`);
  } else {
    const createdTabId = await createAutomationTab(tabRef, url, true);
    if (createdTabId) {
      appendLog(run, step.id, 'success', `✅ Opened new tab: ${url}`);
    } else {
      appendLog(run, step.id, 'warn', `Tab not found for open_url: ${url}`);
    }
  }

  return { success: true };
}

// ──────────────────────────────────────────────
// Resolve tab ID for a step
// ──────────────────────────────────────────────

function getTabIdForStep(step: WorkflowStep, _run: Run): number | null {
  const tabRef = step.tabRef;
  if (!tabRef) return null;
  const tabIds = getAutomationTabIds();
  return tabIds[tabRef] ?? null;
}

// ──────────────────────────────────────────────
// Pause / Resume / Stop
// ──────────────────────────────────────────────

export function pauseRun(): void {
  isPaused = true;
  if (currentRun) {
    currentRun.status = 'paused';
    broadcastState(currentRun);
  }
}

export function resumeRun(): void {
  isPaused = false;
  if (currentRun) {
    currentRun.status = 'running';
    broadcastState(currentRun);
  }
}

export function stopRun(): void {
  isStopped = true;
  isPaused = false;
  if (currentRun) {
    currentRun.status = 'failed';
    currentRun.finishedAt = new Date().toISOString();
    broadcastState(currentRun);
    saveRun(currentRun);
  }
}

// ──────────────────────────────────────────────
// Log helper
// ──────────────────────────────────────────────

function appendLog(
  run: Run,
  stepId: string,
  level: RunLog['level'],
  message: string,
  data?: unknown
): void {
  const log: RunLog = {
    stepId,
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };
  run.logs.push(log);
  // Keep logs bounded
  if (run.logs.length > 500) run.logs.shift();
}
