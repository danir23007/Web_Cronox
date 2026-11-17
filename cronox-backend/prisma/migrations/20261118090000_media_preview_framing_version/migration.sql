-- Preserve existing presentation. Only an explicit save from the new editor
-- opts a placement into editable mobile vertical positioning.
ALTER TABLE "WebsiteMediaPlacement" ADD COLUMN "framingVersion" INTEGER NOT NULL DEFAULT 1;
