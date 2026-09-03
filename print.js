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
 * Google protobuf DayOfWeek enum: MONDAY=1 ... SUNDAY=7.
 * Keep this in sync with interceptor.js.
 */
const DAY_LABELS = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

const els = {
  emptyState: document.getElementById("emptyState"),
  content: document.getElementById("content"),
  childName: document.getElementById("childName"),
  deviceInfo: document.getElementById("deviceInfo"),
  timetableHead: document.querySelector(".timetable-head"),
  timetableBody: document.querySelector(".timetable-body"),
  summaryList: document.getElementById("summaryList"),
  debug: document.getElementById("debug"),
  debugOutput: document.getElementById("debugOutput"),
  copyDebugBtn: document.getElementById("copyDebugBtn"),
  printBtn: document.getElementById("printBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  statusText: document.getElementById("statusText"),
};

function getRequestedChildId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("childId") || "unknown";
}

function parseTimeToHour(value) {
  if (typeof value === "number") {
    if (value >= 0 && value <= 24) {
      return value;
    }
    // Assume milliseconds or seconds since midnight.
    if (value < 100000) {
      return value / 3600;
    }
    return (value % 86400000) / 3600000;
  }

  if (typeof value === "string") {
    const cleaned = value.trim();

    // "HH:MM" or "HH:MM:SS"
    const timeMatch = cleaned.match(
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i,
    );
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      const meridiem = timeMatch[4]?.toLowerCase();
      if (meridiem === "pm" && hour < 12) {
        hour += 12;
      }
      if (meridiem === "am" && hour === 12) {
        hour = 0;
      }
      return hour + minute / 60;
    }

    // ISO 8601 duration (e.g. "PT8H30M")
    const durationMatch = cleaned.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (durationMatch) {
      const h = parseInt(durationMatch[1] || "0", 10);
      const m = parseInt(durationMatch[2] || "0", 10);
      return h + m / 60;
    }

    // Unix timestamps
    const numeric = Date.parse(cleaned);
    if (!isNaN(numeric)) {
      const date = new Date(numeric);
      return date.getHours() + date.getMinutes() / 60;
    }
  }

  return null;
}

function hourToLabel(hour) {
  const totalMinutes = Math.round((hour % 24) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const mm = m.toString().padStart(2, "0");
  return `${h.toString().padStart(2, "0")}:${mm}`;
}

function formatWindow(startHour, endHour) {
  const start = hourToLabel(startHour);
  const end = hourToLabel(endHour);
  return `${start} – ${end}`;
}

function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined || isNaN(minutes)) {
    return null;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) {
    return `${h}h`;
  }
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function isHourAllowed(hour, windows) {
  return windows.some((w) => {
    const start = w.start;
    const end = w.end;
    if (end < start) {
      return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
  });
}

function normalizeDay(daySchedule) {
  if (Array.isArray(daySchedule)) {
    return { allowed: daySchedule, blocked: [], dailyLimitMinutes: null };
  }
  if (daySchedule && typeof daySchedule === "object") {
    return {
      allowed: Array.isArray(daySchedule.allowed) ? daySchedule.allowed : [],
      blocked: Array.isArray(daySchedule.blocked) ? daySchedule.blocked : [],
      dailyLimitMinutes: daySchedule.dailyLimitMinutes ?? null,
    };
  }
  return { allowed: [], blocked: [], dailyLimitMinutes: null };
}

function renderTimetable(schedule) {
  // Header: day label + 24 hours.
  els.timetableHead.innerHTML = '<span class="day-label">Day</span>';
  for (let hour = 0; hour < 24; hour++) {
    const span = document.createElement("span");
    span.className = "hour-label";
    span.textContent = hour.toString().padStart(2, "0");
    els.timetableHead.appendChild(span);
  }

  els.timetableBody.innerHTML = "";

  for (const day of DAYS) {
    const daySchedule = normalizeDay(schedule && schedule[day]);
    const allowedHours = new Set();

    for (const win of daySchedule.allowed) {
      const start = parseTimeToHour(win.start);
      const end = parseTimeToHour(win.end);
      if (start === null || end === null) {
        continue;
      }

      let s = Math.floor(start);
      let e = Math.ceil(end);
      if (e <= s) {
        e = s + 1;
      }
      for (let h = s; h < e && h < 24; h++) {
        allowedHours.add(h);
      }
    }

    const row = document.createElement("div");
    row.className = "timetable-row";

    const dayLabel = document.createElement("span");
    dayLabel.className = "day-label";
    dayLabel.textContent = DAY_LABELS[day];
    row.appendChild(dayLabel);

    for (let hour = 0; hour < 24; hour++) {
      const cell = document.createElement("div");
      const allowed = allowedHours.has(hour);
      cell.className = `hour-cell ${allowed ? "allowed" : "blocked"}`;
      cell.setAttribute(
        "aria-label",
        `${day} ${hourToLabel(hour)} ${allowed ? "allowed" : "blocked"}`,
      );
      row.appendChild(cell);
    }

    els.timetableBody.appendChild(row);
  }
}

function renderSummary(schedule) {
  els.summaryList.innerHTML = "";

  for (const day of DAYS) {
    const daySchedule = normalizeDay(schedule && schedule[day]);

    const dt = document.createElement("dt");
    dt.textContent = DAY_LABELS[day];
    els.summaryList.appendChild(dt);

    const dd = document.createElement("dd");
    const parts = [];

    if (daySchedule.allowed.length === 0) {
      parts.push("No allowed time");
    } else {
      parts.push(
        "Allowed: " +
          daySchedule.allowed
            .map((w) => {
              const start = parseTimeToHour(w.start);
              const end = parseTimeToHour(w.end);
              if (start === null || end === null) {
                return `${w.start} – ${w.end}`;
              }
              return formatWindow(start, end);
            })
            .join(", "),
      );
    }

    if (daySchedule.blocked.length > 0) {
      parts.push(
        "Blocked: " +
          daySchedule.blocked
            .map((w) => {
              const start = parseTimeToHour(w.start);
              const end = parseTimeToHour(w.end);
              if (start === null || end === null) {
                return `${w.start} – ${w.end}`;
              }
              return formatWindow(start, end);
            })
            .join(", "),
      );
    }

    if (daySchedule.dailyLimitMinutes !== null) {
      parts.push(
        `Daily limit: ${formatMinutes(daySchedule.dailyLimitMinutes)}`,
      );
    }

    dd.textContent = parts.join(" • ");
    els.summaryList.appendChild(dd);
  }
}

function renderDebug(data) {
  if (!els.debugOutput) {
    return;
  }
  const safe = JSON.parse(
    JSON.stringify(data, (key, value) => {
      if (key === "raw" && value && typeof value === "object") {
        return value;
      }
      return value;
    }),
  );
  els.debugOutput.textContent = JSON.stringify(safe, null, 2);
}

function render(data) {
  if (!data) {
    els.emptyState.classList.remove("hidden");
    els.content.classList.add("hidden");
    if (els.debug) els.debug.classList.add("hidden");
    return;
  }

  els.emptyState.classList.add("hidden");
  els.content.classList.remove("hidden");
  if (els.debug) els.debug.classList.remove("hidden");

  const childName = data.child?.childName || data.child?.name || "Child";
  els.childName.textContent = `${childName}’s device time`;

  const parts = [];
  if (data.child?.deviceCount) {
    parts.push(
      `${data.child.deviceCount} device${data.child.deviceCount === 1 ? "" : "s"}`,
    );
  } else if (data.child?.deviceName) {
    parts.push(`Device: ${data.child.deviceName}`);
  }
  if (data.child?.timeZone) {
    parts.push(`Timezone: ${data.child.timeZone}`);
  }
  if (data.child?.childId) {
    parts.push(`ID: ${data.child.childId}`);
  }
  if (data.interceptedAt) {
    const when = new Date(data.interceptedAt).toLocaleString();
    parts.push(`Captured: ${when}`);
  }
  els.deviceInfo.textContent = parts.join(" • ");

  renderTimetable(data.schedule);
  renderSummary(data.schedule);
  renderDebug(data);
}

async function loadData() {
  els.statusText.textContent = "Loading…";

  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const store = result[STORAGE_KEY] || {};
    const entries = Object.entries(store);

    // Prefer the childId from the URL, otherwise use the most recent capture.
    const requestedChildId = getRequestedChildId();
    let data = store[requestedChildId];

    if (!data && entries.length > 0) {
      data = entries
        .map(([, value]) => value)
        .sort((a, b) => (b.interceptedAt || 0) - (a.interceptedAt || 0))[0];
    }

    if (data) {
      render(data);
      els.statusText.textContent =
        requestedChildId === "unknown" || !store[requestedChildId]
          ? `Showing data for child ${data.child?.childId || "unknown"}.`
          : "";
    } else {
      render(null);
      els.statusText.textContent = "No data for this child yet.";
    }
  } catch (error) {
    console.error("[Family Link Time Printer] Failed to load data:", error);
    render(null);
    els.statusText.textContent = "Error loading data.";
  }
}

els.printBtn.addEventListener("click", () => {
  window.print();
});

els.reloadBtn.addEventListener("click", () => {
  loadData();
});

if (els.copyDebugBtn) {
  els.copyDebugBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.debugOutput.textContent);
      els.copyDebugBtn.textContent = "Copied!";
      setTimeout(() => {
        els.copyDebugBtn.textContent = "Copy debug data";
      }, 2000);
    } catch (err) {
      console.error("Failed to copy debug data:", err);
    }
  });
}

// Load data when the tab opens.
loadData();
