import { CONTENT_SCRIPT_PATH } from '../shared/constants';

// ──────────────────────────────────────────────
// Tab reference tracking (for recording)
// Maps real tabId -> { ref, url, title }
// ──────────────────────────────────────────────

export const tabRefMap: Record<number, { ref: string; url: string; title: string }> = {};
let tabRefCounter = 0;

export function registerTab(tabId: number, url: string, title: string): string {
  if (tabRefMap[tabId]) {
    tabRefMap[tabId].url = url;
    tabRefMap[tabId].title = title;
    return tabRefMap[tabId].ref;
  }
  const ref = `tab_${++tabRefCounter}`;
  tabRefMap[tabId] = { ref, url, title };
  return ref;
}

export function clearTabRefMap(): void {
  for (const key of Object.keys(tabRefMap)) {
    delete tabRefMap[parseInt(key, 10)];
  }
  tabRefCounter = 0;
}

// ──────────────────────────────────────────────
// Automation window management
// ──────────────────────────────────────────────

let automationWindowId: number | null = null;

/** Map of tabRef -> actual tab ID in the automation window */
const automationTabIds: Record<string, number> = {};

export function getAutomationWindowId(): number | null {
  return automationWindowId;
}

export function getAutomationTabIds(): Record<string, number> {
  return automationTabIds;
}

export async function createAutomationWindow(
  tabRefs: Record<string, { url: string; title: string }>
): Promise<{ windowId: number; tabMap: Record<string, number> }> {
  // Close previous automation window if still open
  if (automationWindowId !== null) {
    await chrome.windows.remove(automationWindowId).catch(() => {});
    automationWindowId = null;
  }

  // Clear old tab mappings
  for (const k of Object.keys(automationTabIds)) delete automationTabIds[k];

  const refs = Object.entries(tabRefs);
  const firstRef = refs[0];

  // Create window with first tab
  const win = await chrome.windows.create({
    url: firstRef ? firstRef[1].url : 'about:blank',
    type: 'normal',
    focused: true,
  });

  if (!win.id) throw new Error('Failed to create automation window');
  automationWindowId = win.id;

  if (firstRef && win.tabs?.[0]?.id) {
    automationTabIds[firstRef[0]] = win.tabs[0].id;
    // wait for first tab to load
    await waitForTabLoad(win.tabs[0].id);
    await injectContentScript(win.tabs[0].id);
  }

  // Open remaining tabs in same window
  for (let i = 1; i < refs.length; i++) {
    const [ref, info] = refs[i];
    const tab = await chrome.tabs.create({
      windowId: automationWindowId,
      url: info.url,
      active: false,
    });
    if (tab.id) {
      automationTabIds[ref] = tab.id;
      await waitForTabLoad(tab.id);
      await injectContentScript(tab.id);
    }
  }

  return { windowId: automationWindowId, tabMap: { ...automationTabIds } };
}

export async function closeAutomationWindow(): Promise<void> {
  if (automationWindowId !== null) {
    await chrome.windows.remove(automationWindowId).catch(() => {});
    automationWindowId = null;
  }
}

// ──────────────────────────────────────────────
// Tab operations
// ──────────────────────────────────────────────

export async function focusTab(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
  if (automationWindowId !== null) {
    await chrome.windows.update(automationWindowId, { focused: true });
  }
}

export async function openTabUrl(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
  await waitForTabLoad(tabId);
}

export async function waitForTabLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // don't reject, just continue
    }, timeoutMs);

    function listener(
      changedTabId: number,
      info: chrome.tabs.TabChangeInfo
    ): void {
      if (changedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Check if already loaded
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => resolve());
  });
}

// ──────────────────────────────────────────────
// Content script injection
// ──────────────────────────────────────────────

const injectedTabs = new Set<number>();

export async function ensureContentScript(tabId: number): Promise<void> {
  if (injectedTabs.has(tabId)) {
    // Verify it's still alive
    const alive = await pingContentScript(tabId);
    if (alive) return;
    injectedTabs.delete(tabId);
  }
  await injectContentScript(tabId);
}

async function injectContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH],
    });
    injectedTabs.add(tabId);
    // Small delay for script to initialize
    await new Promise((r) => setTimeout(r, 300));
  } catch (err) {
    console.warn('[Loop TabManager] Could not inject content script into tab', tabId, err);
  }
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'CONTENT_SCRIPT_READY',
      source: 'background',
    });
    return true;
  } catch {
    return false;
  }
}

export function markTabInjected(tabId: number): void {
  injectedTabs.add(tabId);
}

export function clearInjectedTabs(): void {
  injectedTabs.clear();
}
