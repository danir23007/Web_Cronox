-- Campaign writes are available only through the guarded backend, never the Data API.
ALTER TABLE "BlackFridaySettings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "BlackFridaySettings" FROM PUBLIC;

-- Preserve every field of any existing production campaign, especially activation.
-- The preceding defaults migration provides the approved Spanish text and Madrid dates.
INSERT INTO "BlackFridaySettings" ("id", "enabled") VALUES ('global', false)
ON CONFLICT ("id") DO NOTHING;
