(() => {
  'use strict';

  const MARKER = 'family-link-time-printer';

  function forwardToBackground(payload) {
    try {
      chrome.runtime.sendMessage({ source: MARKER, payload });
    } catch (error) {
      // The background worker may be unavailable; this is non-fatal.
      console.debug('[Family Link Time Printer] Failed to forward message:', error);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return;
    }
    if (!event.data || event.data.source !== MARKER) {
      return;
    }

    forwardToBackground(event.data.payload);
  });
})();
