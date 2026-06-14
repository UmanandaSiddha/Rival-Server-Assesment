-- migrate:up

-- Application user. Email-only auth: email is the sole identifier (required + unique).
CREATE TABLE "User" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "password" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "timezone" TEXT,
    "notificationPreferences" JSONB NOT NULL DEFAULT '{}',
    "lastSeenAt" TIMESTAMPTZ,
    "lastLogin" TIMESTAMPTZ,
    "oneTimePassword" TEXT,
    "oneTimeExpire" TIMESTAMPTZ,
    "resetToken" TEXT,
    "resetTokenExpire" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");

-- Refresh-token session (one row per login; refreshToken stored hashed).
CREATE TABLE "Session" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Session_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Session_userId_expiresAt_idx" ON "Session" ("userId", "expiresAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session" ("expiresAt");

-- migrate:down

DROP TABLE IF EXISTS "Session";
DROP TABLE IF EXISTS "User";
