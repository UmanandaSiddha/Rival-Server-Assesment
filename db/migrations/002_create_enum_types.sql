-- migrate:up

-- Auth (email-only). Email + password, with email OTP for verification / passwordless login.
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- Granular team permissions. Roles are bags of these (see "Role".permissions), so owners/admins
-- can compose custom roles instead of being limited to fixed role names.
CREATE TYPE "Permission" AS ENUM (
    'TASK_READ',
    'TASK_CREATE',
    'TASK_UPDATE',
    'TASK_DELETE',
    'TASK_UPDATE_STATUS',
    'TASK_UPDATE_PRIORITY',
    'TASK_ASSIGN',
    'MEMBER_INVITE',
    'MEMBER_REMOVE',
    'MEMBER_UPDATE_ROLE',
    'ROLE_CREATE',
    'ROLE_UPDATE',
    'ROLE_DELETE',
    'TEAM_UPDATE',
    'TEAM_DELETE'
);

-- Team invitation lifecycle.
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');

-- Tasks. Priority is declared low -> urgent so `ORDER BY priority` sorts by severity.
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- Per-task activity log (history of changes).
CREATE TYPE "TaskActivityAction" AS ENUM (
    'CREATED',
    'UPDATED',
    'STATUS_CHANGED',
    'ASSIGNED',
    'COMPLETED',
    'REOPENED',
    'DELETED'
);

-- Attachment kind: an uploaded file (stored locally / S3 later) or an external link.
CREATE TYPE "AttachmentType" AS ENUM ('FILE', 'LINK');

-- migrate:down

DROP TYPE IF EXISTS "AttachmentType";
DROP TYPE IF EXISTS "TaskActivityAction";
DROP TYPE IF EXISTS "TaskPriority";
DROP TYPE IF EXISTS "TaskStatus";
DROP TYPE IF EXISTS "InviteStatus";
DROP TYPE IF EXISTS "Permission";
DROP TYPE IF EXISTS "UserRole";
