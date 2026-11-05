-- Additive: the previous release never reads the new column.
-- Identity color shown for a person in shared group chats; NULL for earlier accounts.
ALTER TABLE "user" ADD COLUMN "color" TEXT;
