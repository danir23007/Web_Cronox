-- Administrator-only metadata. Existing templates deliberately remain unclassified.
ALTER TABLE "ManagedEmailTemplate" ADD COLUMN "visualClassification" TEXT;
ALTER TABLE "ManagedEmailTemplate" ADD CONSTRAINT "ManagedEmailTemplate_visualClassification_check"
  CHECK ("visualClassification" IS NULL OR "visualClassification" IN ('FOR_ALL', 'UNIQUE', 'DIFFERENT'));
