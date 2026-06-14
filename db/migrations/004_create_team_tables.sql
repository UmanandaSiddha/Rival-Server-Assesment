-- migrate:up

-- A team owns tasks. Every user gets one auto-created team on signup (isDefault = true) so the
-- base "users only see their own tasks" rule is just "tasks of teams I belong to". isDefault is
-- immutable (it marks the undeletable home team); whether a team is "solo" is derived from its
-- member count, not stored. Members can be added to any team, including the default one.
CREATE TABLE "Team" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Team_ownerId_fkey"
        FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Team_ownerId_idx" ON "Team" ("ownerId");

-- A role is a named bag of permissions. teamId NULL = global system template shared by all teams
-- (isSystem = true, not editable/deletable); teamId set = a custom role created within that team.
-- The team OWNER (Team.ownerId) always has every permission implicitly and is never gated by a
-- role, so editing roles can never lock the owner out.
CREATE TABLE "Role" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" "Permission"[] NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Role_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Role_teamId_idx" ON "Role" ("teamId");
-- Role names are unique per team; one set of named system roles globally (teamId IS NULL).
CREATE UNIQUE INDEX "Role_teamId_name_key" ON "Role" ("teamId", "name");
CREATE UNIQUE INDEX "Role_system_name_key" ON "Role" ("name") WHERE "teamId" IS NULL;

-- Built-in system roles (global). Custom roles can be added per team referencing these as a base.
INSERT INTO "Role" ("id", "teamId", "name", "description", "isSystem", "permissions") VALUES
    (
        'role_system_admin', NULL, 'Admin', 'Full access to tasks, members and roles.', true,
        ARRAY[
            'TASK_READ','TASK_CREATE','TASK_UPDATE','TASK_DELETE','TASK_UPDATE_STATUS',
            'TASK_UPDATE_PRIORITY','TASK_ASSIGN','MEMBER_INVITE','MEMBER_REMOVE',
            'MEMBER_UPDATE_ROLE','ROLE_CREATE','ROLE_UPDATE','ROLE_DELETE','TEAM_UPDATE','TEAM_DELETE'
        ]::"Permission"[]
    ),
    (
        'role_system_member', NULL, 'Member', 'Can create and work on tasks.', true,
        ARRAY[
            'TASK_READ','TASK_CREATE','TASK_UPDATE','TASK_UPDATE_STATUS','TASK_UPDATE_PRIORITY','TASK_ASSIGN'
        ]::"Permission"[]
    );

-- Team membership. Authorization for any action = the acting user has a row here for the relevant
-- team and their role's permissions allow it (the team owner and app-level User.role='ADMIN' bypass).
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeamMember_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_roleId_fkey"
        FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One membership row per (team, user).
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember" ("teamId", "userId");
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember" ("userId");
CREATE INDEX "TeamMember_roleId_idx" ON "TeamMember" ("roleId");

-- Team invitation by email. The invitee may not have an account yet, so we key on email and a
-- secure token (the invite link); on accept we link the accepting user back via acceptedById.
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "teamId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "invitedById" TEXT,
    "acceptedById" TEXT,
    "token" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "acceptedAt" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invite_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invite_roleId_fkey"
        FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invite_invitedById_fkey"
        FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invite_acceptedById_fkey"
        FOREIGN KEY ("acceptedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Invite_token_key" ON "Invite" ("token");
CREATE INDEX "Invite_email_idx" ON "Invite" ("email");
CREATE INDEX "Invite_teamId_status_idx" ON "Invite" ("teamId", "status");
-- At most one outstanding (pending) invite per team + email.
CREATE UNIQUE INDEX "Invite_teamId_email_pending_key"
    ON "Invite" ("teamId", "email") WHERE "status" = 'PENDING';

-- migrate:down

DROP TABLE IF EXISTS "Invite";
DROP TABLE IF EXISTS "TeamMember";
DROP TABLE IF EXISTS "Role";
DROP TABLE IF EXISTS "Team";
