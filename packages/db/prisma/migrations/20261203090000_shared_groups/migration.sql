-- Additive: the previous release never reads the new table or column.
-- People the group's owner added; the owner is the group's userId and is not listed here.
CREATE TABLE "chat_group_users" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_group_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_group_users_groupId_userId_key" ON "chat_group_users"("groupId", "userId");
CREATE INDEX "chat_group_users_userId_idx" ON "chat_group_users"("userId");

ALTER TABLE "chat_group_users" ADD CONSTRAINT "chat_group_users_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_group_users" ADD CONSTRAINT "chat_group_users_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who wrote a person's message in a shared group; NULL for every message before this release.
ALTER TABLE "messages" ADD COLUMN "senderUserId" TEXT;
