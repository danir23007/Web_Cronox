(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CRONOX_CHECKOUT_PRESENCE = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function create({ request, uuid = () => crypto.randomUUID(), onChange = () => {}, now = () => Date.now(), schedule = setInterval, unschedule = clearInterval }) {
    let tabId = uuid(), state = null, timer = null, stopped = false, unavailable = true;
    let serverOffset = 0, heartbeatPending = false, latestServerTime = 0;
    const ready = () => !unavailable && !!state && state.reservationPhase !== 'RECONCILING' && new Date(state.expiresAt).getTime() > now() + serverOffset;
    const adopt = (next, reason = 'adopt', requestedAt) => {
      const serverTime = next.serverNow ? new Date(next.serverNow).getTime() : 0;
      if (serverTime && serverTime < latestServerTime) return state;
      if (state?.paymentStartedAt && next.checkoutSnapshotId === state.checkoutSnapshotId && !next.paymentStartedAt) return state;
      const previous = state;
      if (serverTime) {
        latestServerTime = serverTime;
        // Count the whole round trip against the deadline. A response delayed
        // for minutes must not make an old server timestamp look current.
        if (requestedAt !== undefined) serverOffset = serverTime - requestedAt;
      }
      state = next; unavailable = false; onChange(state, null, reason, previous); return state;
    };
    const fail = error => { unavailable = true; onChange(state, error, 'error'); throw error; };
    const send = async (action, keepalive = false) => {
      const requestedAt = now();
      const response = await request('reservation', { action, tabId }, keepalive);
      return { response, requestedAt };
    };
    const heartbeat = async () => {
      if (stopped || heartbeatPending) return;
      heartbeatPending = true;
      try { const result = await send('heartbeat'); adopt(result.response, 'heartbeat', result.requestedAt); }
      catch (error) { unavailable = true; onChange(state, error, 'error'); }
      finally { heartbeatPending = false; }
    };
    return {
      ready, current: () => state, identity: () => ({ tabId, checkoutSnapshotId: state?.checkoutSnapshotId }), adopt,
      async enter(restart = false) {
        stopped = false;
        // A restart/reloaded page is a new incarnation, never a revived tombstone.
        if (restart) { try { await send('leave', true); } catch {} tabId = uuid(); }
        try {
          const result = await send(restart ? 'restart' : 'enter');
          adopt(result.response, 'enter', result.requestedAt);
          if (!timer) timer = schedule(heartbeat, 20000);
          return state;
        } catch (error) { return fail(error); }
      },
      heartbeat,
      async protect(paymentIntentId) {
        if (!ready()) throw new Error('La reserva no está disponible. Comprueba de nuevo el stock.');
        try {
          const requestedAt = now();
          const confirmed = await request('payment-start', { ...this.identity(), paymentIntentId });
          if (!confirmed.paymentStartedAt || confirmed.reservationPhase !== 'PROTECTED') throw new Error('No se confirmó la reserva del pago.');
          adopt(confirmed, 'start', requestedAt);
          if (!ready()) throw new Error('La reserva ha caducado antes de confirmar el pago. Comprueba su estado.');
          return state;
        } catch (error) { return fail(error); }
      },
      async leave(explicit = false) {
        stopped = true;
        if (timer) unschedule(timer); timer = null;
        // Still send the page identity: the server decides whether another tab
        // is present or payment already won the race. Never release on visibility.
        try { await send(explicit ? 'leave' : 'depart', true); } catch { /* Server lease remains the fallback. */ }
      },
      async restore() { tabId = uuid(); return this.enter(); },
      stop() { stopped = true; if (timer) unschedule(timer); timer = null; },
    };
  }
  return Object.freeze({ create });
});
