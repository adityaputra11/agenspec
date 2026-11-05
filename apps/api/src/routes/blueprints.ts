import { ORPCError } from "@orpc/server";
import type { BotReference } from "@rakazo/contracts";
import { attachmentMaxBytes } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { BlueprintNotFoundError, createBotFromBlueprint, runAsSystem } from "@rakazo/db";
import { orgMembershipOf } from "../org-admin.js";
import {
  decodeOrganizationDocument,
  removeOrganizationDocuments,
  storeOrganizationDocument,
} from "./cms.js";
import type { RouterContext } from "./context.js";

type ReferenceRow = {
  id: string;
  referenceName: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  status: string;
  error: string | null;
};

function referenceView(row: ReferenceRow): BotReference {
  return {
    id: row.id,
    referenceName: row.referenceName ?? "",
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    status: row.status as BotReference["status"],
    error: row.error,
  };
}

/**
 * The member's bot in their current Space, when it was made from a blueprint that still exists in
 * their organization. Anything else is NOT_FOUND, so one member's bot is never visible to another.
 */
async function blueprintBotOf(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  botId: string,
) {
  const membership = await orgMembershipOf(prisma, actor);
  if (!membership) throw new ORPCError("NOT_FOUND");
  const bot = await prisma.bot.findFirst({
    where: { id: botId, spaceId: actor.spaceId, userId: actor.userId },
    select: { blueprintId: true },
  });
  const blueprintId = bot?.blueprintId;
  if (!blueprintId) throw new ORPCError("NOT_FOUND");
  const blueprint = await runAsSystem("read a bot's blueprint", () =>
    prisma.agentBlueprint.findFirst({
      where: { id: blueprintId, organizationId: membership.organizationId },
      select: { id: true, referenceNames: true },
    }),
  );
  if (!blueprint) throw new ORPCError("NOT_FOUND");
  return { organizationId: membership.organizationId, blueprint };
}

export function blueprintRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    blueprints: {
      list: authed.blueprints.list.handler(async ({ context }) => {
        const membership = await orgMembershipOf(deps.prisma, context.actor);
        if (!membership) return [];
        const rows = await runAsSystem("list agent blueprints for members", () =>
          deps.prisma.agentBlueprint.findMany({
            where: { organizationId: membership.organizationId },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true, description: true, referenceNames: true },
          }),
        );
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          referenceNames: row.referenceNames,
        }));
      }),
      createBot: authed.blueprints.createBot.handler(async ({ context, input }) => {
        try {
          return await createBotFromBlueprint(deps.prisma, context.actor, input);
        } catch (error) {
          if (error instanceof BlueprintNotFoundError) throw new ORPCError("NOT_FOUND");
          throw error;
        }
      }),
      references: {
        list: authed.blueprints.references.list.handler(async ({ context, input }) => {
          const { organizationId } = await blueprintBotOf(deps.prisma, context.actor, input.botId);
          const rows = await runAsSystem("list a bot's reference documents", () =>
            deps.prisma.organizationDocument.findMany({
              where: { botId: input.botId, organizationId },
              orderBy: { createdAt: "asc" },
            }),
          );
          return rows.map(referenceView);
        }),
        upload: authed.blueprints.references.upload.handler(async ({ context, input }) => {
          const { organizationId, blueprint } = await blueprintBotOf(
            deps.prisma,
            context.actor,
            input.botId,
          );
          // Stored under the blueprint's own spelling, so slots match whatever case was typed.
          const wanted = input.referenceName.toLowerCase();
          const referenceName = blueprint.referenceNames.find(
            (name) => name.toLowerCase() === wanted,
          );
          if (!referenceName) {
            throw new ORPCError("BAD_REQUEST", { message: "Unknown reference document" });
          }
          const { bytes, mimeType } = decodeOrganizationDocument(
            input.contentBase64,
            input.mimeType,
            attachmentMaxBytes(deps.env),
          );
          const row = await storeOrganizationDocument(deps, context.actor.userId, organizationId, {
            name: input.name.trim(),
            mimeType,
            bytes,
            botId: input.botId,
            referenceName,
            signal: context.signal,
          });
          // The new document fills the slot; the one it replaces goes once the new one is saved.
          const replaced = await runAsSystem("find the reference document a new one replaces", () =>
            deps.prisma.organizationDocument.findMany({
              where: {
                botId: input.botId,
                organizationId,
                referenceName,
                id: { not: row.id },
              },
              select: { id: true, artifactStorageId: true },
            }),
          );
          await removeOrganizationDocuments(deps, organizationId, context.actor.userId, replaced, {
            signal: context.signal,
          });
          return referenceView(row);
        }),
        remove: authed.blueprints.references.remove.handler(async ({ context, input }) => {
          const { organizationId } = await blueprintBotOf(deps.prisma, context.actor, input.botId);
          const row = await runAsSystem("read a bot's reference document", () =>
            deps.prisma.organizationDocument.findFirst({
              where: { id: input.id, botId: input.botId, organizationId },
              select: { id: true, artifactStorageId: true },
            }),
          );
          if (!row) throw new ORPCError("NOT_FOUND");
          await removeOrganizationDocuments(deps, organizationId, context.actor.userId, [row], {
            signal: context.signal,
          });
          return { ok: true as const };
        }),
      },
    },
  };
}
