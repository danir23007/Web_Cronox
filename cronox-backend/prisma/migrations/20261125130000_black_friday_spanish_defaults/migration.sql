-- Defaults for new configurations; saved custom campaigns are left intact.
ALTER TABLE "BlackFridaySettings"
  ALTER COLUMN "bannerText" SET DEFAULT 'BLACK FRIDAY SOLO EN BLACK FRIDAY · 27/11 — DESDE EL 26/11 A LAS 21:00',
  ALTER COLUMN "startsAt" SET DEFAULT '2026-11-26 20:00:00+00'::timestamptz;
