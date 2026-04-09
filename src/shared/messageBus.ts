import type { Message } from './types';

/** Send a message to the background service worker */
export async function sendMessage(msg: Omit<Message, 'source'> & { source?: Message['source'] }): Promise<unknown> {
  return chrome.runtime.sendMessage({ ...msg, source: msg.source ?? 'sidepanel' });
}

/** Send a message to a content script in a specific tab */
export async function sendTabMessage(
  tabId: number,
  msg: Omit<Message, 'source'>
): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, { ...msg, source: 'background' });
}

/** Register a typed message listener */
export function onMessage(
  handler: (msg: Message, sender: chrome.runtime.MessageSender) => unknown | Promise<unknown>
): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const result = handler(msg as Message, sender);
    if (result instanceof Promise) {
      result.then(sendResponse).catch((err: unknown) => {
        console.error('[Loop] message handler error:', err);
        sendResponse(null);
      });
      return true; // keep channel open for async
    }
    if (result !== undefined) {
      sendResponse(result);
    }
    return false;
  });
}
