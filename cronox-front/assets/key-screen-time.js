(function (globalScope) {
  "use strict";

  const TIME_ZONE = "Europe/Madrid";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const partsFor = (value) =>
    Object.fromEntries(
      formatter
        .formatToParts(new Date(value))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );

  const parseLocal = (value) => {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(
        String(value || "").trim(),
      );
    if (!match) throw new Error("INVALID_MADRID_LOCAL_TIME");
    const [, year, month, day, hour, minute] = match;
    const numbers = [year, month, day, hour, minute].map(Number);
    const wallClockUtc = Date.UTC(
      numbers[0],
      numbers[1] - 1,
      numbers[2],
      numbers[3],
      numbers[4],
    );
    const expected = { year, month, day, hour, minute };
    const candidates = [];
    for (let offsetMinutes = -180; offsetMinutes <= 240; offsetMinutes += 15) {
      const candidate = wallClockUtc - offsetMinutes * 60_000;
      const actual = partsFor(candidate);
      if (
        Object.entries(expected).every(([key, part]) => actual[key] === part)
      ) {
        candidates.push(candidate);
      }
    }
    const unique = [...new Set(candidates)];
    if (unique.length === 0) throw new Error("NONEXISTENT_MADRID_LOCAL_TIME");
    if (unique.length > 1) throw new Error("AMBIGUOUS_MADRID_LOCAL_TIME");
    return new Date(unique[0]).toISOString();
  };

  const toInputValue = (value) => {
    if (!value) return "";
    const parts = partsFor(value);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };

  const display = (value) =>
    new Intl.DateTimeFormat("es-ES", {
      timeZone: TIME_ZONE,
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(value));

  globalScope.CRONOX_MADRID_TIME = Object.freeze({
    TIME_ZONE,
    display,
    madridLocalToUtc: parseLocal,
    utcToMadridLocal: toInputValue,
  });
})(window);
