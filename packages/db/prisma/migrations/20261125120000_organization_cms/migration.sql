-- Additive: the previous release never reads these tables.
CREATE TABLE "organization_policies" (
    "organizationId" TEXT NOT NULL,
    "restrictApps" BOOLEAN NOT NULL DEFAULT false,
    "allowedApps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_policies_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "organization_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_documents_organizationId_idx" ON "organization_documents"("organizationId");
