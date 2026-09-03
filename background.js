const MARKER = 'family-link-time-printer';
const STORAGE_KEY = 'latestFamilyLinkData';

/**
 * Store the latest intercepted schedule keyed by the current tab.
 * We keep only the most recent payload per childId so the print page
 * can render the currently selected child.
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.source !== MARKER || !message.payload) {
    return;
  }

  const payload = message.payload;

  // Ignore the interceptor-ready ping; it carries no schedule data.
  if (payload.type === 'interceptor-ready') {
    return;
  }

  chrome.storage.session.get(STORAGE_KEY).then((result) => {
    const store = result[STORAGE_KEY] || {};

    const childId = payload.child?.childId || 'unknown';
    const existing = store[childId];

    // Keep the newest payload. If the new payload has no parsed schedule
    // but we already have one, preserve the existing data.
    const merged = {
      ...(existing || {}),
      ...payload,
      child: {
        ...(existing?.child || {}),
        ...(payload.child || {})
      },
      interceptedAt: payload.interceptedAt || Date.now()
    };

    // Always keep the latest schedule and raw payload so the print page can
    // fall back to debug view when parsing fails or returns empty. Never
    // overwrite a valid schedule with null from a non-schedule response.
    if ('schedule' in payload) {
      merged.schedule = payload.schedule ?? existing?.schedule ?? null;
    }
    if ('raw' in payload) {
      merged.raw = payload.raw;
    }

    store[childId] = merged;

    return chrome.storage.session.set({ [STORAGE_KEY]: store });
  });
});

function extractChildIdFromUrl(urlString) {
  try {
    const url = new URL(urlString || '');
    const pathMatch = url.pathname.match(/(?:child|kid|member|people)[/=]([a-zA-Z0-9_-]+)/i);
    if (pathMatch) {
      return pathMatch[1];
    }
    for (const key of ['childId', 'memberId', 'kidId', 'userId', 'personId', 'personIds']) {
      const value = url.searchParams.get(key);
      if (value) {
        return value.split(',')[0].trim();
      }
    }
  } catch {
    // ignore
  }
  return 'unknown';
}

/**
 * Clicking the extension icon opens the printable timetable page.
 * The print page reads the latest data from chrome.storage.session.
 */
chrome.action.onClicked.addListener(async (tab) => {
  const childId = extractChildIdFromUrl(tab.url);
  const printUrl = chrome.runtime.getURL(`print.html?childId=${encodeURIComponent(childId)}`);
  await chrome.tabs.create({ url: printUrl });
});
