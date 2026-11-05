-- Additive: the previous release never reads this table.
CREATE TABLE "legal_answer_cache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "documentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_answer_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_answer_cache_organizationId_questionKey_version_key"
  ON "legal_answer_cache"("organizationId", "questionKey", "version");
CREATE INDEX "legal_answer_cache_expiresAt_idx" ON "legal_answer_cache"("expiresAt");

ALTER TABLE "legal_answer_cache" ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_answer_cache_tenant ON "legal_answer_cache"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY legal_answer_cache_system ON "legal_answer_cache"
  USING ((SELECT app_rls_bypass()));
