-- Opaque token for publicly scannable membership QR URLs. Existing legacy
-- member codes are deliberately not exposed through the public validation API.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "publicMemberToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_publicMemberToken_key"
  ON "User"("publicMemberToken");
