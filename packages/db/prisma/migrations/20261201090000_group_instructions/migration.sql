-- Instructions every bot follows in one group chat; empty for existing groups.
ALTER TABLE "chat_groups" ADD COLUMN "instructions" TEXT NOT NULL DEFAULT '';
