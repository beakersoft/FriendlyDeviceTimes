(() => {
  "use strict";

  // Marker used to identify messages sent from this interceptor.
  const MARKER = "family-link-time-printer";

  /**
   * Best-effort URL patterns that Family Link uses when fetching screen-time
   * schedules. These may change at any time and should be treated as guesses
   * until verified against live traffic.
   */
  const INTERESTING_URL_PATTERNS = [
    /familylink/i,
    /screentime/i,
    /screen[_-]?time/i,
    /device[_-]?time/i,
    /allow/i,
    /schedule/i,
    /child/i,
    /member/i,
    /v1\/family/i,
    /kids/i,
    /kidsmanagement-pa/i,
    /timelimit/i,
  ];

  function isDebugEnabled() {
    try {
      return localStorage.getItem("flt-debug") === "1";
    } catch {
      return false;
    }
  }

  function debug(...args) {
    if (isDebugEnabled()) {
      console.log("[Family Link Time Printer]", ...args);
    }
  }

  function looksInteresting(url) {
    const lower = url.toLowerCase();
    return INTERESTING_URL_PATTERNS.some((pattern) => pattern.test(lower));
  }

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  function sendPayload(payload) {
    window.postMessage(
      {
        source: MARKER,
        type: "family-link-response",
        payload,
      },
      window.location.origin,
    );
  }

  function isBetterChildId(current, candidate) {
    if (!candidate) {
      return false;
    }
    if (!current) {
      return true;
    }
    // Prefer identifiers that look like real Google person IDs (long numeric
    // strings) over short internal indexes such as /people/2/.
    const currentLooksReal = /^\d{10,}$/.test(current);
    const candidateLooksReal = /^\d{10,}$/.test(candidate);
    if (currentLooksReal && !candidateLooksReal) {
      return false;
    }
    if (!currentLooksReal && candidateLooksReal) {
      return true;
    }
    // Otherwise keep the longer/more specific one.
    return candidate.length > current.length;
  }

  function extractChildIdentifier(url) {
    // Family Link URLs sometimes include the child id in the path or query.
    // Examples we have seen:
    //   /familylink/child/<id>/...
    //   /kidsmanagement/v1/people/<id>/timeLimit
    //   ?childId=<id>
    //   ?memberId=<id>
    try {
      const urlObj = new URL(url, window.location.href);
      let best = undefined;

      const pathMatches = urlObj.pathname.matchAll(
        /(?:child|kid|member|people)[/=]([a-zA-Z0-9_-]+)/gi,
      );
      for (const match of pathMatches) {
        if (isBetterChildId(best, match[1])) {
          best = match[1];
        }
      }

      for (const key of [
        "childId",
        "memberId",
        "kidId",
        "userId",
        "personId",
        "personIds",
      ]) {
        const value = urlObj.searchParams.get(key);
        if (!value) {
          continue;
        }
        // personIds may be comma-separated; take the first real-looking ID.
        const candidates = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const candidate of candidates) {
          if (isBetterChildId(best, candidate)) {
            best = candidate;
          }
        }
      }
      return best;
    } catch {
      // ignore
    }
    return undefined;
  }

  /**
   * Google protobuf DayOfWeek enum: MONDAY=1 ... SUNDAY=7.
   * If your Family Link UI starts the week on Sunday, flip this mapping.
   */
  const DAY_OF_WEEK_MAP = {
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
    7: "sunday",
  };

  const DAYS = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  function emptyDaySchedule() {
    return { allowed: [], blocked: [], dailyLimitMinutes: null };
  }

  function timeArrayToHour(arr) {
    if (!Array.isArray(arr) || arr.length < 1) {
      return null;
    }
    const hour = arr[0];
    const minute = arr[1] || 0;
    if (typeof hour !== "number" || typeof minute !== "number") {
      return null;
    }
    return hour + minute / 60;
  }

  /**
   * Family Link returns blocked windows that may wrap midnight (e.g. 20:00-07:00).
   * Split them at midnight so we can compute the allowed gaps within a single day.
   */
  function splitBlockedAtMidnight(blocked) {
    const segments = [];
    for (const w of blocked) {
      let start = w.start;
      let end = w.end;
      if (end < start) {
        end += 24;
      }
      if (start < 24 && end > 24) {
        segments.push({ start, end: 24 });
        segments.push({ start: 0, end: end - 24 });
      } else if (start < 24) {
        segments.push({ start, end: Math.min(end, 24) });
      } else {
        segments.push({ start: start - 24, end: Math.min(end - 24, 24) });
      }
    }
    return segments.sort((a, b) => a.start - b.start);
  }

  function mergeSegments(segments) {
    const merged = [];
    for (const seg of segments) {
      const last = merged[merged.length - 1];
      if (!last || seg.start > last.end) {
        merged.push({ ...seg });
      } else {
        last.end = Math.max(last.end, seg.end);
      }
    }
    return merged;
  }

  function computeAllowedFromBlocked(blocked) {
    if (!blocked || blocked.length === 0) {
      return [{ start: 0, end: 24 }];
    }
    const split = splitBlockedAtMidnight(blocked);
    const merged = mergeSegments(split);
    const allowed = [];
    let cursor = 0;
    for (const seg of merged) {
      if (seg.start > cursor) {
        allowed.push({ start: cursor, end: seg.start });
      }
      cursor = Math.max(cursor, seg.end);
    }
    if (cursor < 24) {
      allowed.push({ start: cursor, end: 24 });
    }
    return allowed;
  }

  function looksLikeTimeWindowEntry(entry) {
    return (
      Array.isArray(entry) &&
      entry.length >= 5 &&
      typeof entry[1] === "number" &&
      entry[1] >= 1 &&
      entry[1] <= 7 &&
      Array.isArray(entry[3]) &&
      typeof entry[3][0] === "number" &&
      Array.isArray(entry[4]) &&
      typeof entry[4][0] === "number"
    );
  }

  function looksLikeDailyLimitEntry(entry) {
    return (
      Array.isArray(entry) &&
      entry.length >= 4 &&
      typeof entry[1] === "number" &&
      entry[1] >= 1 &&
      entry[1] <= 7 &&
      typeof entry[3] === "number" &&
      !Array.isArray(entry[3])
    );
  }

  /**
   * Parses the protobuf-list response from the Family Link /timeLimit and
   * /appliedTimeLimits endpoints.
   *
   * We have seen at least two shapes:
   *
   * 1) /timeLimit (SUPERVISED_DEVICES):
   *    [
   *      [null, timestamp],
   *      [
   *        [1, [ [id, day, 2, [20,0], [7,0], ...], ... ], created, updated, 1],
   *        [ [2, [6,0], [ [id, day, 2, 305, ...], ... ], created, updated] ],
   *        ...
   *      ]
   *    ]
   *
   * 2) /appliedTimeLimits:
   *    [
   *      [null, timestamp],
   *      [
   *        [
   *          null, null,
   *          [id, 4, 2, 305, ...],          // daily limit, Thursday
   *          null, null,
   *          [id, 5, 2, 305, ...],          // daily limit, Friday
   *          ...,
   *          [id, 4, 2, [20,0], [7,0], ...] // downtime window, Thursday
   *        ]
   *      ]
   *    ]
   *
   * The parser scans the response recursively for entries that look like daily
   * limit entries (day-of-week + number of minutes) or time window entries
   * (day-of-week + [hour, minute] start/end).
   */
  function tryParseFamilyLinkTimeLimit(body) {
    if (!Array.isArray(body)) {
      return null;
    }

    const schedule = {};
    for (const day of DAYS) {
      schedule[day] = emptyDaySchedule();
    }

    let foundAny = false;

    function visit(node, depth) {
      if (depth > 8 || !Array.isArray(node)) {
        return;
      }

      // Daily limit entry: [id, dayIndex, type, minutes, ...]
      if (looksLikeDailyLimitEntry(node)) {
        const dayName = DAY_OF_WEEK_MAP[node[1]];
        if (dayName) {
          schedule[dayName].dailyLimitMinutes = node[3];
          foundAny = true;
        }
        return;
      }

      // Time window entry: [id, dayIndex, type, [startHour, startMin], [endHour, endMin], ...]
      if (looksLikeTimeWindowEntry(node)) {
        const dayName = DAY_OF_WEEK_MAP[node[1]];
        if (dayName) {
          const startHour = timeArrayToHour(node[3]);
          const endHour = timeArrayToHour(node[4]);
          if (startHour !== null && endHour !== null) {
            schedule[dayName].blocked.push({ start: startHour, end: endHour });
            foundAny = true;
          }
        }
        return;
      }

      for (const child of node) {
        visit(child, depth + 1);
      }
    }

    visit(body, 0);

    if (!foundAny) {
      return null;
    }

    // Derive allowed windows from blocked windows.
    for (const day of DAYS) {
      schedule[day].allowed = computeAllowedFromBlocked(schedule[day].blocked);
    }

    return schedule;
  }

  function extractScheduleFromBody(body) {
    // Family Link /timeLimit returns a protobuf-list array; try that first.
    const timeLimitSchedule = tryParseFamilyLinkTimeLimit(body);
    if (timeLimitSchedule) {
      return timeLimitSchedule;
    }

    // This is a defensive, best-effort parser for other response shapes.
    // Family Link's response format is undocumented, so we look for the most
    // common shapes and fall back to returning the raw body for inspection.

    if (!body || typeof body !== "object") {
      return null;
    }

    function isWindowLike(obj) {
      return (
        obj &&
        typeof obj === "object" &&
        (("startTime" in obj && "endTime" in obj) ||
          ("start" in obj && "end" in obj) ||
          ("from" in obj && "to" in obj) ||
          ("startHour" in obj && "endHour" in obj))
      );
    }

    function normalizeWindow(win) {
      const start =
        win.startTime ??
        win.start ??
        win.from ??
        win.startHour ??
        win.begin ??
        null;
      const end =
        win.endTime ?? win.end ?? win.to ?? win.endHour ?? win.finish ?? null;
      if (start == null || end == null) {
        return null;
      }
      return { start, end };
    }

    // Case 1: response is already a schedule keyed by day.
    if (DAYS.some((d) => d in body || body[d])) {
      const schedule = {};
      for (const day of DAYS) {
        const raw =
          body[day] ??
          body[day.toUpperCase()] ??
          body[day.charAt(0).toUpperCase() + day.slice(1)];
        if (Array.isArray(raw)) {
          schedule[day] = {
            allowed: raw.map(normalizeWindow).filter(Boolean),
            blocked: [],
            dailyLimitMinutes: null,
          };
        } else if (raw && typeof raw === "object") {
          const arr = raw.windows ??
            raw.times ??
            raw.allowedTimes ??
            raw.periods ??
            raw.intervals ?? [raw];
          schedule[day] = {
            allowed: (Array.isArray(arr) ? arr : [arr])
              .map(normalizeWindow)
              .filter(Boolean),
            blocked: [],
            dailyLimitMinutes: null,
          };
        } else {
          schedule[day] = emptyDaySchedule();
        }
      }
      return schedule;
    }

    // Case 2: schedule is nested under a known key.
    const candidateKeys = [
      "screenTimeSettings",
      "deviceTimeSettings",
      "dailyLimitSettings",
      "schedule",
      "schedules",
      "allowedTimes",
      "timeLimits",
      "dailySchedule",
      "limits",
      "data",
      "result",
    ];

    for (const key of candidateKeys) {
      const nested = body[key];
      if (nested && typeof nested === "object") {
        const parsed = extractScheduleFromBody(nested);
        if (parsed) {
          return parsed;
        }
      }
    }

    // Case 3: response is an array of window-like objects with day references.
    if (Array.isArray(body)) {
      const schedule = {};
      for (const day of DAYS) {
        schedule[day] = emptyDaySchedule();
      }
      for (const item of body) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const dayKey =
          item.dayOfWeek ??
          item.day ??
          item.weekDay ??
          item.dayOfWeekValue ??
          Object.keys(item).find((k) => DAYS.includes(k.toLowerCase()));
        if (dayKey && isWindowLike(item)) {
          const normalized = normalizeWindow(item);
          if (normalized) {
            const dayName = dayKey.toLowerCase();
            if (DAYS.includes(dayName)) {
              schedule[dayName].allowed.push(normalized);
            }
          }
        }
      }
      if (Object.values(schedule).some((d) => d.allowed.length > 0)) {
        return schedule;
      }
    }

    return null;
  }

  function maybeExtractChildInfo(body, url) {
    const info = {
      childId:
        extractChildIdentifier(url) ||
        extractChildIdentifier(window.location.href),
    };

    if (body && typeof body === "object") {
      info.childName =
        body.childName ??
        body.name ??
        body.displayName ??
        body.firstName ??
        body.nickname ??
        undefined;

      info.deviceName =
        body.deviceName ??
        body.device ??
        body.deviceModel ??
        body.model ??
        undefined;

      info.timeZone =
        body.timeZone ?? body.timezone ?? body.zone ?? body.tz ?? undefined;
    }

    // Try to pull device info from the Family Link pblib response.
    try {
      const devices = body?.[1]?.[2];
      if (Array.isArray(devices) && devices.length > 0) {
        info.deviceCount = devices.length;
        // The device "name" field appears to be an obfuscated string in the
        // protobuf response; we keep the first one as a fallback identifier.
        info.deviceName = devices[0][3] || info.deviceName;
      }
    } catch {
      // ignore
    }

    return info;
  }

  function isScheduleEndpoint(url) {
    const lower = url.toLowerCase();
    // Match /timeLimit (with or without trailing query params) and
    // /appliedTimeLimits endpoints.
    return (
      /\/timelimit(?:\?|\/|$)/i.test(lower) ||
      lower.includes("/appliedtimelimits")
    );
  }

  function handleResponse(url, status, rawBody) {
    const interesting = looksInteresting(url);
    debug(
      "handleResponse",
      url,
      "interesting=",
      interesting,
      "status=",
      status,
    );

    if (!interesting) {
      return;
    }

    const body = tryParseJson(rawBody);
    if (!body) {
      debug("Could not parse response body as JSON", rawBody.slice(0, 200));
      return;
    }

    const childInfo = maybeExtractChildInfo(body, url);

    // Only extract schedules from the actual time-limit endpoints.
    // Other kidsmanagement endpoints (photos, app usage, etc.) have similar
    // protobuf-list shapes and would otherwise overwrite the real data.
    const isSchedule = isScheduleEndpoint(url);
    const schedule = isSchedule ? extractScheduleFromBody(body) : null;

    debug(
      "Parsed schedule",
      schedule,
      "child",
      childInfo,
      "isSchedule=",
      isSchedule,
    );

    // Skip forwarding non-schedule kidsmanagement traffic entirely so it cannot
    // overwrite stored schedule data.
    if (!isSchedule) {
      return;
    }

    sendPayload({
      url,
      status,
      child: childInfo,
      schedule,
      raw: body,
      interceptedAt: Date.now(),
    });
  }

  // Patch fetch
  const originalFetch = window.fetch;
  window.fetch = async function familyLinkFetch(...args) {
    const request = args[0];
    const url = typeof request === "string" ? request : request?.url;

    debug("fetch intercepted", url);

    try {
      const response = await originalFetch.apply(this, args);
      if (url) {
        handleResponse(url, response.status, await response.clone().text());
      }
      return response;
    } catch (error) {
      // Re-throw so the page's own error handling is unchanged.
      throw error;
    }
  };

  // Patch XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function familyLinkOpen(
    method,
    url,
    ...rest
  ) {
    this._familyLinkUrl = url;
    this._familyLinkMethod = method;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function familyLinkSend(...args) {
    const url = this._familyLinkUrl;
    debug("XHR intercepted", url);

    if (url && looksInteresting(url)) {
      const onReady = () => {
        if (this.readyState === 4) {
          try {
            handleResponse(url, this.status, this.responseText);
          } catch {
            // ignore
          }
        }
      };
      this.addEventListener("readystatechange", onReady);
    }
    return originalSend.apply(this, args);
  };

  // Notify the content script that the interceptor is ready.
  sendPayload({
    type: "interceptor-ready",
    href: window.location.href,
  });

  debug("Interceptor installed");
})();
