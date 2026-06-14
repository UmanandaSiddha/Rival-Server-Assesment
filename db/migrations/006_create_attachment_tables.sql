-- migrate:up

-- Task attachments: either an uploaded FILE or an external LINK (type discriminates).
--   FILE  -> stored on the server now (storageProvider = 'local', url = served path); the same
--            row works for S3 later by switching storageProvider = 's3' and url to the object URL.
--   LINK  -> url is the external URL; sizeBytes/mimeType/storageProvider stay NULL.
-- previewUrl + metadata back the UI preview: a thumbnail path for images/docs, or the scraped
-- OpenGraph image for links. metadata (JSONB) holds the flexible rest — OG title/description,
-- image width/height, original filename, etc. — so we don't add a column per attachment kind.
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "taskId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "type" "AttachmentType" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "storageProvider" TEXT,
    "previewUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskAttachment_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskAttachment_uploadedById_fkey"
        FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment" ("taskId");

-- migrate:down

DROP TABLE IF EXISTS "TaskAttachment";
