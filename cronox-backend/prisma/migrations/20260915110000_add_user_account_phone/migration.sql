-- Store the account/administrative contact phone independently from delivery addresses.
-- Existing users and every Address row remain unchanged; their account phone starts as NULL.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
