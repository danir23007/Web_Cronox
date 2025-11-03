-- AlterTable
-- Convert User.id back to an autoincrementing integer and ensure auth fields exist
CREATE TABLE "_User_new" (
    "id" SERIAL NOT NULL,
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
    "name",
    "role",
    "isEmailVerified",
    "refreshTokenHash",
    "resetTokenHash",
    "resetTokenExp",
    "createdAt",
    "updatedAt"
)
SELECT
    CASE
        WHEN "id" ~ '^[0-9]+$' THEN "id"::INTEGER
        ELSE nextval('"_User_new_id_seq"')
    END,
    "email",
    "passwordHash",
    "name",
    COALESCE("role", 'customer'),
    COALESCE("isEmailVerified", false),
    "refreshTokenHash",
    "resetTokenHash",
    "resetTokenExp",
    "createdAt",
    "updatedAt"
FROM "User";

DROP TABLE "User";

ALTER TABLE "_User_new" RENAME TO "User";
ALTER INDEX "_User_new_email_key" RENAME TO "User_email_key";

ALTER SEQUENCE "_User_new_id_seq" RENAME TO "User_id_seq";
ALTER SEQUENCE "User_id_seq" OWNED BY "User"."id";

-- Ensure sequence is set to the max id to avoid conflicts
SELECT setval('"User_id_seq"', COALESCE((SELECT MAX("id") FROM "User"), 0));
