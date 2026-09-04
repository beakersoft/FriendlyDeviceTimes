const MARKER = "family-link-time-printer";
const STORAGE_KEY = "latestFamilyLinkData";

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * A day schedule is "meaningful" if it actually restricts time, as opposed to
 * the empty/default shape used when a response doesn't cover that day at all
 * (e.g. /appliedTimeLimits often only describes the current day).
 */
function isMeaningfulDaySchedule(daySchedule) {
  if (!daySchedule) {
    return false;
  }
  const isDefaultAllowed =
    Array.isArray(daySchedule.allowed) &&
    daySchedule.allowed.length === 1 &&
    daySchedule.allowed[0].start === 0 &&
    daySchedule.allowed[0].end === 24;
  const hasBlocked =
    Array.isArray(daySchedule.blocked) && daySchedule.blocked.length > 0;
  const hasLimit = daySchedule.dailyLimitMinutes !== null && daySchedule.dailyLimitMinutes !== undefined;
  return hasBlocked || hasLimit || !isDefaultAllowed;
}

/**
 * Merge a newly captured schedule into the existing one on a per-day basis.
 * Responses can be partial (only describing "today"), so days without
 * meaningful data in the new capture should keep whatever was known before
 * instead of being reset to the default "fully allowed" state.
 */
function mergeSchedules(existingSchedule, newSchedule) {
  if (!newSchedule) {
    return existingSchedule ?? null;
  }
  if (!existingSchedule) {
    return newSchedule;
  }

  const merged = {};
  for (const day of DAYS) {
    const newDay = newSchedule[day];
    merged[day] = isMeaningfulDaySchedule(newDay) ? newDay : existingSchedule[day] ?? newDay;
  }
  return merged;
}

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
  if (payload.type === "interceptor-ready") {
    return;
  }

  chrome.storage.session.get(STORAGE_KEY).then((result) => {
    const store = result[STORAGE_KEY] || {};

    const childId = payload.child?.childId || "unknown";
    const existing = store[childId];

    // Keep the newest payload. If the new payload has no parsed schedule
    // but we already have one, preserve the existing data.
    const merged = {
      ...(existing || {}),
      ...payload,
      child: {
        ...(existing?.child || {}),
        ...(payload.child || {}),
      },
      interceptedAt: payload.interceptedAt || Date.now(),
    };

    // Always keep the latest schedule and raw payload so the print page can
    // fall back to debug view when parsing fails or returns empty. Never
    // overwrite a valid schedule with null from a non-schedule response.
    // Merge per-day since responses can be partial (e.g. only "today").
    if ("schedule" in payload) {
      merged.schedule = mergeSchedules(existing?.schedule, payload.schedule);
    }
    if ("raw" in payload) {
      merged.raw = payload.raw;
    }

    store[childId] = merged;

    return chrome.storage.session.set({ [STORAGE_KEY]: store });
  });
});

function extractChildIdFromUrl(urlString) {
  try {
    const url = new URL(urlString || "");
    const pathMatch = url.pathname.match(
      /(?:child|kid|member|people)[/=]([a-zA-Z0-9_-]+)/i,
    );
    if (pathMatch) {
      return pathMatch[1];
    }
    for (const key of [
      "childId",
      "memberId",
      "kidId",
      "userId",
      "personId",
      "personIds",
    ]) {
      const value = url.searchParams.get(key);
      if (value) {
        return value.split(",")[0].trim();
      }
    }
  } catch {
    // ignore
  }
  return "unknown";
}

/**
 * Clicking the extension icon opens the printable timetable page.
 * The print page reads the latest data from chrome.storage.session.
 */
chrome.action.onClicked.addListener(async (tab) => {
  const childId = extractChildIdFromUrl(tab.url);
  const printUrl = chrome.runtime.getURL(
    `print.html?childId=${encodeURIComponent(childId)}`,
  );
  await chrome.tabs.create({ url: printUrl });
});
