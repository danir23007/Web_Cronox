(function (globalScope) {
  "use strict";

  const SYSTEMS = Object.freeze({
    APPAREL: Object.freeze(["XS", "S", "M", "L", "XL", "XXL"]),
    US_RING: Object.freeze(["US_6", "US_7", "US_8", "US_9", "US_10", "US_11", "US_12"]),
  });
  const ALL = Object.freeze([...SYSTEMS.APPAREL, ...SYSTEMS.US_RING]);

  const key = (value) => {
    const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    return /^US_?(?:6|7|8|9|10|11|12)$/.test(normalized)
      ? normalized.replace(/^US_?/, "US_")
      : normalized;
  };
  const label = (value) => key(value).replace(/^US_/, "US ");
  const order = (value) => {
    const index = ALL.indexOf(key(value));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const values = (system) => [...(SYSTEMS[key(system)] || SYSTEMS.APPAREL)];
  const sort = (list) => [...(Array.isArray(list) ? list : [])].sort(
    (left, right) => order(left?.size ?? left) - order(right?.size ?? right),
  );

  globalScope.CRONOX_SIZES = Object.freeze({ SYSTEMS, key, label, order, sort, values });
})(window);
