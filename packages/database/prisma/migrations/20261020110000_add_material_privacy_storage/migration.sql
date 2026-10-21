-- Keep a sanitized representation with each saved material and version.
-- Existing rows remain unchanged until a user saves their content again.
ALTER TABLE "materials"
  ADD COLUMN "maskedBody" JSONB,
  ADD COLUMN "privacyMode" TEXT;

ALTER TABLE "material_versions"
  ADD COLUMN "maskedBody" JSONB,
  ADD COLUMN "privacyMode" TEXT;
