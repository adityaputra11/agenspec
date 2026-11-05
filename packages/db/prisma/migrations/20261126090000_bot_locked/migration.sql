-- Additive: the previous release never reads this column.
ALTER TABLE "bots" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
