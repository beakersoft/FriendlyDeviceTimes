# Family Link Time Printer

A Chrome extension that captures your child's screen-time schedule from the
Family Link web app and renders it as a printable wall timetable.

## How it works

The Family Link web app already loads your child's allowed-device-time data
from Google's internal APIs while you are signed in. This extension runs a
small script inside the Family Link page to observe those authenticated
responses, extracts the schedule, and shows it on a clean print-friendly page.

No username or password is collected. The extension only reads data that is
already being shown to you in the browser.

## Install (development / unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this folder (`device-time-print`).
4. The extension icon should appear in your toolbar.

## Use

1. Sign in to [Family Link](https://families.google.com/familylink/) in Chrome.
2. Open the screen-time / device schedule page for the child you want to print.
3. Click the extension icon in the toolbar.
4. A new tab opens with the timetable.
5. Click **Print** to send it to your printer.

## Customising the parser

Google's Family Link API is not documented, so the extension includes a
best-effort parser in `interceptor.js`. If the timetable is empty or wrong:

1. Open Chrome DevTools while on the Family Link schedule page.
2. Go to the **Network** tab and look for XHR/fetch requests.
3. Find the request that returns your child's allowed-time windows.
4. Note the URL and the JSON field names.
5. Update `INTERESTING_URL_PATTERNS` and `extractScheduleFromBody` in
   `interceptor.js` to match the real response shape.

You can also enable debug logging by adding this line to the console while on
the Family Link page:

```js
localStorage.setItem("flt-debug", "1");
```

Reload the page and the interceptor will log every intercepted response to the
console.

## Files

- `manifest.json` — Chrome extension manifest (MV3).
- `interceptor.js` — Runs inside the Family Link page and captures API
  responses.
- `content.js` — Bridges the page context and the extension background worker.
- `background.js` — Stores the latest schedule and opens the print tab.
- `print.html`, `print.css`, `print.js` — Render and print the timetable.
- `icons/` — Extension icons.

## Privacy

All data stays in your browser. Nothing is sent to external servers.

## Limitations

- The exact Family Link response format may change; the parser may need updates.
- The extension only captures the currently selected child.
