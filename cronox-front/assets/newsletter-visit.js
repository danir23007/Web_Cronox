(function (globalScope) {
  "use strict";
  // Preserve the session controller if this shared script is loaded again.
  if (globalScope.CRONOX_NEWSLETTER_VISIT) {
    if (typeof module !== "undefined" && module.exports) module.exports = globalScope.CRONOX_NEWSLETTER_VISIT;
    return;
  }
  const SESSION_KEY = "cronoxNewsletterShown";
  const OPEN_DELAY_MS = 5500;
  let sharedVisit;
  const create = (options = {}) => {
    const shared = Object.keys(options).length === 0;
    if (shared && sharedVisit) return sharedVisit;
    const scheduleTimeout = options.setTimeout || globalScope.setTimeout.bind(globalScope);
    const cancelTimeout = options.clearTimeout || globalScope.clearTimeout.bind(globalScope);
    const availableStorage = (provided, name) => {
      if (provided) return provided;
      try { return globalScope[name]; } catch { return null; }
    };
    const session = availableStorage(options.sessionStorage, "sessionStorage");
    let shownInMemory = false;
    let timer = 0;
    const read = (storage, key) => { try { return storage?.getItem(key); } catch { return null; } };
    const write = (storage, key, value) => { try { storage?.setItem(key, value); } catch {} };
    const eligible = () => !shownInMemory && read(session, SESSION_KEY) !== "true";
    const cancel = () => { if (timer) cancelTimeout(timer); timer = 0; };
    const markShown = () => {
      shownInMemory = true;
      // Session-only UI state, independent of account and preference consent.
      write(session, SESSION_KEY, "true");
      cancel();
    };
    const dismiss = cancel;
    const schedule = (callback) => {
      if (timer || !eligible()) return false;
      timer = scheduleTimeout(() => { timer = 0; if (eligible()) callback(); }, OPEN_DELAY_MS);
      return true;
    };
    const visit = { eligible, markShown, dismiss, schedule, cancel, hasPending: () => Boolean(timer), wasShown: () => !eligible() };
    if (shared) sharedVisit = visit;
    return visit;
  };
  globalScope.CRONOX_NEWSLETTER_VISIT = Object.freeze({ SESSION_KEY, OPEN_DELAY_MS, create });
  if (typeof module !== "undefined" && module.exports) module.exports = globalScope.CRONOX_NEWSLETTER_VISIT;
})(typeof window !== "undefined" ? window : globalThis);
