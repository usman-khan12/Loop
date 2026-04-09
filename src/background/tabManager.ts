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
    await ensureContentScript(win.tabs[0].id);
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

export async function createAutomationTab(tabRef: string, url: string, active = false): Promise<number | null> {
  if (automationWindowId === null) return null;

  const tab = await chrome.tabs.create({
    windowId: automationWindowId,
    url,
    active,
  });

  if (!tab.id) return null;

  automationTabIds[tabRef] = tab.id;
  await waitForTabLoad(tab.id);
  await ensureContentScript(tab.id);
  return tab.id;
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
  const alive = await pingContentScript(tabId);
  if (alive) {
    injectedTabs.add(tabId);
    return;
  }

  await waitForContentScript(tabId);

  const ready = await pingContentScript(tabId);
  if (ready) {
    injectedTabs.add(tabId);
    return;
  }

  console.warn('[Loop TabManager] Content script not ready in tab', tabId);
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

async function waitForContentScript(tabId: number, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const alive = await pingContentScript(tabId);
    if (alive) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
