-- Additive for the previous release, which still reads organization_documents.content (now nullable).
ALTER TABLE "organization_documents" ALTER COLUMN "content" DROP NOT NULL;
ALTER TABLE "organization_documents" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "organization_documents" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'processing';
ALTER TABLE "organization_documents" ADD COLUMN "error" TEXT;
ALTER TABLE "organization_documents" ADD COLUMN "chunkCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "organization_documents" ADD COLUMN "artifactStorageId" TEXT;

-- Existing documents were stored as plaintext and never chunked. Remove that copy and ask for
-- an upload, which stores the original file and encrypted sections.
UPDATE "organization_documents"
SET "spaceId" = "organizationId",
    "content" = NULL,
    "status" = 'failed',
    "error" = 'Upload this document again to index it.';

-- Bot-readable copies in memory are replaced by the search tools; the plaintext ones go.
DELETE FROM "memory_documents" WHERE "scope" = 'user' AND "path" LIKE 'company/%';

CREATE TABLE "organization_document_chunks" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "searchTokens" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_document_chunks_documentId_idx" ON "organization_document_chunks"("documentId");
CREATE INDEX "organization_document_chunks_organizationId_idx" ON "organization_document_chunks"("organizationId");
CREATE INDEX "organization_document_chunks_searchTokens_idx" ON "organization_document_chunks" USING GIN ("searchTokens");

-- Same policies as the other space-scoped tables (20261021140000_row_level_security).
ALTER TABLE "organization_document_chunks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_document_chunks_tenant ON "organization_document_chunks"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY organization_document_chunks_system ON "organization_document_chunks"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "organization_documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_documents_tenant ON "organization_documents"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY organization_documents_system ON "organization_documents"
  USING (current_setting('app.rls_bypass', true) = 'on');
