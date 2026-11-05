-- A bot can turn off agent skills by name; empty keeps every skill available.
ALTER TABLE "bots" ADD COLUMN "disabledSkills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
