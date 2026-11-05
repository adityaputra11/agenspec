-- Additive: the previous release never reads the new column.
ALTER TABLE "organization_policies" ADD COLUMN "timesheetServerUrl" TEXT;
