(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CRONOX_CHECKOUT_LIFECYCLE = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const createCoordinator = () => {
    let revision = 0;
    let queue = Promise.resolve(false);

    return {
      current: () => revision,
      invalidate: () => {
        revision += 1;
        return revision;
      },
      isCurrent: (candidate) => candidate === revision,
      enqueue: (candidate, task) => {
        const run = async () => {
          if (candidate !== revision) return false;
          return task(() => candidate === revision);
        };
        queue = queue.catch(() => false).then(run);
        return queue;
      },
    };
  };

  const pollUntilProcessed = async ({
    fetchStatus,
    onProcessed,
    shouldContinue = () => true,
    delay = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    intervalMs = 1500,
    maxAttempts = 40,
  }) => {
    let lastStatus = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!shouldContinue()) return { outcome: 'cancelled', status: lastStatus };
      lastStatus = await fetchStatus();
      if (!shouldContinue()) return { outcome: 'cancelled', status: lastStatus };
      if (lastStatus?.isProcessed) {
        if (typeof onProcessed === 'function') await onProcessed(lastStatus);
        return { outcome: 'processed', status: lastStatus };
      }
      if (attempt + 1 < maxAttempts) await delay(intervalMs);
    }
    return { outcome: 'timeout', status: lastStatus };
  };

  return Object.freeze({ createCoordinator, pollUntilProcessed });
});
