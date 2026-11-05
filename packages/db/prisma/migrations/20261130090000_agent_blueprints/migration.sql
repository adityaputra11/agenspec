-- Additive: the previous release never reads the new table or columns.
CREATE TABLE "agent_blueprints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "spaceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL,
    "referenceNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_blueprints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_blueprints_organizationId_idx" ON "agent_blueprints"("organizationId");

-- Same policies as the other organization tables (20261128090000_organization_rls_key_check).
ALTER TABLE "agent_blueprints" ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_blueprints_tenant ON "agent_blueprints"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY agent_blueprints_system ON "agent_blueprints"
  USING ((SELECT app_rls_bypass()));

-- A bot made from a blueprint; NULL for every other bot.
ALTER TABLE "bots" ADD COLUMN "blueprintId" TEXT;
CREATE INDEX "bots_blueprintId_idx" ON "bots"("blueprintId");

-- A document that is one bot's reference (NULL: the organization's own document).
ALTER TABLE "organization_documents" ADD COLUMN "botId" TEXT;
ALTER TABLE "organization_documents" ADD COLUMN "referenceName" TEXT;
CREATE INDEX "organization_documents_botId_idx" ON "organization_documents"("botId");
ALTER TABLE "organization_document_chunks" ADD COLUMN "botId" TEXT;
CREATE INDEX "organization_document_chunks_botId_idx" ON "organization_document_chunks"("botId");
