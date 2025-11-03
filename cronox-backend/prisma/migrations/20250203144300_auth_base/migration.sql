-- Drop the old integer-based primary key and recreate the User table with the new schema
CREATE TABLE "_User_new" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'customer',
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "refreshTokenHash" VARCHAR(255),
    "resetTokenHash" VARCHAR(255),
    "resetTokenExp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "_User_new_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "_User_new_email_key" ON "_User_new"("email");

INSERT INTO "_User_new" (
    "id",
    "email",
    "passwordHash",
    "role",
    "createdAt",
    "updatedAt"
)
SELECT
    "id"::TEXT,
    "email",
    "passwordHash",
    COALESCE("role", 'customer'),
    "createdAt",
    "updatedAt"
FROM "User";

DROP TABLE "User";

ALTER TABLE "_User_new" RENAME TO "User";

ALTER INDEX "_User_new_email_key" RENAME TO "User_email_key";

DROP SEQUENCE IF EXISTS "User_id_seq";
