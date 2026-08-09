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

  return Object.freeze({ createCoordinator });
});
