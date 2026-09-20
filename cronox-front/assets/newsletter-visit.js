(function (globalScope) {
  "use strict";
  const SESSION_KEY = "cronoxNewsletterShown";
  const DISMISSED_AT_KEY = "cronoxNewsletterDismissedAt";
  const OPEN_DELAY_MS = 5500;
  const COOLDOWN_MS = 20 * 60 * 1000;
  const create = (options = {}) => {
    const clock = options.now || (() => Date.now());
    const scheduleTimeout = options.setTimeout || globalScope.setTimeout.bind(globalScope);
    const cancelTimeout = options.clearTimeout || globalScope.clearTimeout.bind(globalScope);
    const availableStorage = (provided, name) => {
      if (provided) return provided;
      try { return globalScope[name]; } catch { return null; }
    };
    const session = availableStorage(options.sessionStorage, "sessionStorage");
    const local = availableStorage(options.localStorage, "localStorage");
    const hasConsent = options.hasConsent || (() => false);
    let shownInMemory = false;
    let timer = 0;
    const read = (storage, key) => { try { return storage?.getItem(key); } catch { return null; } };
    const write = (storage, key, value) => { try { storage?.setItem(key, value); } catch {} };
    const eligible = (now = clock()) => {
      if (shownInMemory) return false;
      if (!hasConsent()) return true;
      if (read(session, SESSION_KEY) === "true") return false;
      const dismissedAt = Number(read(local, DISMISSED_AT_KEY));
      return !(Number.isFinite(dismissedAt) && dismissedAt > 0 && now - dismissedAt < COOLDOWN_MS);
    };
    const markShown = () => {
      shownInMemory = true;
      if (hasConsent()) write(session, SESSION_KEY, "true");
    };
    const dismiss = () => {
      if (hasConsent()) write(local, DISMISSED_AT_KEY, String(clock()));
    };
    const cancel = () => { if (timer) cancelTimeout(timer); timer = 0; };
    const schedule = (callback) => {
      if (timer || !eligible()) return false;
      timer = scheduleTimeout(() => { timer = 0; if (eligible()) callback(); }, OPEN_DELAY_MS);
      return true;
    };
    return { eligible, markShown, dismiss, schedule, cancel, hasPending: () => Boolean(timer), wasShown: () => shownInMemory };
  };
  globalScope.CRONOX_NEWSLETTER_VISIT = Object.freeze({ SESSION_KEY, DISMISSED_AT_KEY, OPEN_DELAY_MS, COOLDOWN_MS, create });
  if (typeof module !== "undefined" && module.exports) module.exports = globalScope.CRONOX_NEWSLETTER_VISIT;
})(typeof window !== "undefined" ? window : globalThis);
