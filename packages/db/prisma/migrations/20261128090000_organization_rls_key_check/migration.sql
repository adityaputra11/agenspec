-- System access to the organization tables goes through the keyed bypass check like every
-- other table, not the bare setting, which any session could set.
DROP POLICY organization_documents_system ON "organization_documents";
CREATE POLICY organization_documents_system ON "organization_documents"
  USING ((SELECT app_rls_bypass()));

DROP POLICY organization_document_chunks_system ON "organization_document_chunks";
CREATE POLICY organization_document_chunks_system ON "organization_document_chunks"
  USING ((SELECT app_rls_bypass()));

DROP POLICY organization_model_settings_system ON "organization_model_settings";
CREATE POLICY organization_model_settings_system ON "organization_model_settings"
  USING ((SELECT app_rls_bypass()));
