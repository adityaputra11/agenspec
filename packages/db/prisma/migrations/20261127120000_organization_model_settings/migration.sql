-- Additive: the previous release never reads this table, so members keep their own models.
CREATE TABLE "organization_model_settings" (
    "organizationId" TEXT NOT NULL,
    "spaceId" TEXT,
    "provider" TEXT,
    "modelId" TEXT,
    "baseUrl" TEXT,
    "credentialCipher" TEXT,
    "restrictMemberProviders" BOOLEAN NOT NULL DEFAULT false,
    "allowedProviders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_model_settings_pkey" PRIMARY KEY ("organizationId")
);

-- Same policies as the other space-scoped tables (20261021140000_row_level_security).
ALTER TABLE "organization_model_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_model_settings_tenant ON "organization_model_settings"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY organization_model_settings_system ON "organization_model_settings"
  USING (current_setting('app.rls_bypass', true) = 'on');
