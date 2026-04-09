import type { Workflow, Run } from './types';
import { STORAGE_KEYS } from './constants';

// ──────────────────────────────────────────────
// Workflows
// ──────────────────────────────────────────────

export async function getWorkflows(): Promise<Workflow[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.WORKFLOWS);
  return (result[STORAGE_KEYS.WORKFLOWS] as Workflow[]) ?? [];
}

export async function saveWorkflow(workflow: Workflow): Promise<void> {
  const workflows = await getWorkflows();
  const idx = workflows.findIndex((w) => w.id === workflow.id);
  if (idx >= 0) {
    workflows[idx] = workflow;
  } else {
    workflows.push(workflow);
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.WORKFLOWS]: workflows });
}

export async function deleteWorkflow(id: string): Promise<void> {
  const workflows = await getWorkflows();
  await chrome.storage.local.set({
    [STORAGE_KEYS.WORKFLOWS]: workflows.filter((w) => w.id !== id),
  });
}

// ──────────────────────────────────────────────
// Runs
// ──────────────────────────────────────────────

const MAX_RUNS = 50;

export async function getRuns(): Promise<Run[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.RUNS);
  return (result[STORAGE_KEYS.RUNS] as Run[]) ?? [];
}

export async function saveRun(run: Run): Promise<void> {
  const runs = await getRuns();
  const idx = runs.findIndex((r) => r.id === run.id);
  if (idx >= 0) {
    runs[idx] = run;
  } else {
    runs.unshift(run);
    if (runs.length > MAX_RUNS) runs.length = MAX_RUNS;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.RUNS]: runs });
}

// ──────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────

export interface Settings {
  confirmBeforeSubmit: boolean;
  highlightElements: boolean;
  autoCloseAutomationWindow: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  confirmBeforeSubmit: false,
  highlightElements: true,
  autoCloseAutomationWindow: false,
};

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] as Partial<Settings>) };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: { ...current, ...settings } });
}
