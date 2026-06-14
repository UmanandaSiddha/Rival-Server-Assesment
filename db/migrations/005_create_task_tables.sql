-- migrate:up

-- Core task. Belongs to a team; createdBy is the author, assignee is optional.
CREATE TABLE "Task" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "teamId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    -- Optimistic-lock counter: bump on every update; reject a write whose version is stale so
    -- concurrent edits in the real-time/collaborative flow don't silently clobber each other.
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Task_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey"
        FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Composite indexes are ordered by their leading column: teamId scopes every list query,
-- the second column serves the status filter and the due/priority/created sorts.
CREATE INDEX "Task_teamId_status_idx" ON "Task" ("teamId", "status");
CREATE INDEX "Task_teamId_dueDate_idx" ON "Task" ("teamId", "dueDate");
CREATE INDEX "Task_teamId_priority_idx" ON "Task" ("teamId", "priority");
CREATE INDEX "Task_teamId_created_at_idx" ON "Task" ("teamId", "created_at");
CREATE INDEX "Task_assigneeId_idx" ON "Task" ("assigneeId");

-- Trigram GIN index backs case-insensitive title search: WHERE title ILIKE '%term%'.
CREATE INDEX "Task_title_trgm_idx" ON "Task" USING GIN ("title" gin_trgm_ops);

-- Append-only activity log: one row per change, with a JSONB before/after diff.
CREATE TABLE "TaskActivity" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "TaskActivityAction" NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "TaskActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskActivity_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskActivity_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TaskActivity_taskId_created_at_idx" ON "TaskActivity" ("taskId", "created_at");

-- migrate:down

DROP TABLE IF EXISTS "TaskActivity";
DROP TABLE IF EXISTS "Task";
