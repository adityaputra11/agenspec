import { ORPCError } from "@orpc/server";
import { organizationDocumentProcessJob } from "@rakazo/adapter-kit";
import type { OrganizationDocumentMimeType } from "@rakazo/adapters";
import {
  buildModelConnectPlaintext,
  organizationModelRecord,
  parseModelSecret,
  probeCatalogProviderModels,
  probeOpenAiCompatibleModels,
  verifyCatalogProviderApiKey,
  verifyOpenAiCompatibleApiKey,
} from "@rakazo/adapters";
import type { ModelConnectInput } from "@rakazo/contracts";
import {
  attachmentMaxBytes,
  isOllamaCloudBaseUrl,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  usableModelId,
} from "@rakazo/contracts";
import type { AuditEventInput } from "@rakazo/db";
import { postToLegalBots, recordAuditEvent, runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { mayUsePrivateEndpoint } from "../mcp-servers.js";
import { orgAdminRoles, orgAppPolicyFor, orgMembershipOf, requireOrgAdmin } from "../org-admin.js";
import type { RouterContext } from "./context.js";

const DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

const DEFAULT_POLICY = { restrictApps: false, allowedApps: [] as string[] };

export function cmsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    cms: {
      status: authed.cms.status.handler(async ({ context }) => {
        const membership = await orgMembershipOf(deps.prisma, context.actor);
        const isOrgAdmin = membership !== null && orgAdminRoles(membership.role);
        return {
          isOrgAdmin,
          organizationName: isOrgAdmin ? membership.organizationName : null,
          role: isOrgAdmin ? membership.role : null,
        };
      }),
      policy: {
        get: authed.cms.policy.get.handler(async ({ context }) => {
          await requireOrgAdmin(deps.prisma, context.actor);
          const policy = await orgAppPolicyFor(deps.prisma, context.actor);
          return policy ?? DEFAULT_POLICY;
        }),
        update: authed.cms.policy.update.handler(async ({ context, input }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const allowedApps = [...new Set(input.allowedApps)];
          const saved = await deps.prisma.organizationPolicy.upsert({
            where: { organizationId },
            create: { organizationId, restrictApps: input.restrictApps, allowedApps },
            update: { restrictApps: input.restrictApps, allowedApps },
            select: { restrictApps: true, allowedApps: true },
          });
          await audit(context.actor.userId, organizationId, "organization_policy.changed", {
            restrictApps: saved.restrictApps,
            allowedAppCount: saved.allowedApps.length,
          });
          return saved;
        }),
      },
      models: organizationModelRoutes(ctx),
      members: {
        list: authed.cms.members.list.handler(async ({ context }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const rows = await deps.prisma.member.findMany({
            where: { organizationId },
            orderBy: { createdAt: "asc" },
            select: { userId: true, role: true, user: { select: { name: true, email: true } } },
          });
          return rows.map((row) => ({
            userId: row.userId,
            name: row.user.name,
            email: row.user.email,
            role: row.role,
          }));
        }),
      },
      documents: {
        list: authed.cms.documents.list.handler(async ({ context }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const rows = await runAsSystem("list organization documents", () =>
            deps.prisma.organizationDocument.findMany({
              where: { organizationId, botId: null },
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                name: true,
                mimeType: true,
                sizeBytes: true,
                createdAt: true,
                status: true,
                error: true,
                chunkCount: true,
              },
            }),
          );
          return rows.map((row) => ({
            id: row.id,
            name: row.name,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            createdAt: row.createdAt.toISOString(),
            status: row.status as "processing" | "ready" | "failed",
            error: row.error,
            chunkCount: row.chunkCount,
          }));
        }),
        upload: authed.cms.documents.upload.handler(async ({ context, input }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const { bytes, mimeType } = decodeOrganizationDocument(
            input.contentBase64,
            input.mimeType,
            attachmentMaxBytes(deps.env),
          );
          const row = await storeOrganizationDocument(deps, context.actor.userId, organizationId, {
            name: input.name.trim(),
            mimeType,
            bytes,
            botId: null,
            referenceName: null,
            signal: context.signal,
          });
          return {
            id: row.id,
            name: row.name,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            createdAt: row.createdAt.toISOString(),
            status: "processing" as const,
            error: null,
            chunkCount: 0,
          };
        }),
        announce: authed.cms.documents.announce.handler(async ({ context, input }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const document = await runAsSystem("read an organization document", () =>
            deps.prisma.organizationDocument.findFirst({
              where: { id: input.id, organizationId, botId: null, status: "ready" },
              select: { id: true, name: true },
            }),
          );
          if (!document) throw new ORPCError("NOT_FOUND");
          const written = await postToLegalBots(deps.prisma, {
            organizationId,
            nonce: `announce:${document.id}`,
            blocks: [
              {
                kind: "text",
                text: `New company document: ${document.name}. Ask me about it and I will cite it.`,
              },
            ],
          });
          await Promise.all(
            written.map((item) =>
              deps.events.notify(item.threadId, item.eventSeq).catch((error: unknown) => {
                getLogger().error("announcement realtime notification", error);
              }),
            ),
          );
          await audit(context.actor.userId, organizationId, "organization_document.announced", {
            documentId: document.id,
            documentName: document.name,
            delivered: written.length,
          });
          return { delivered: written.length };
        }),
        delete: authed.cms.documents.delete.handler(async ({ context, input }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const found = await runAsSystem("read an organization document", () =>
            deps.prisma.organizationDocument.findFirst({
              where: { id: input.id, organizationId, botId: null },
              select: { id: true, name: true, artifactStorageId: true },
            }),
          );
          if (!found) throw new ORPCError("NOT_FOUND");
          await removeOrganizationDocuments(deps, organizationId, context.actor.userId, [found], {
            signal: context.signal,
          });
          await audit(context.actor.userId, organizationId, "organization_document.deleted", {
            documentId: found.id,
            documentName: found.name,
          });
          return { ok: true as const };
        }),
      },
      blueprints: {
        list: authed.cms.blueprints.list.handler(async ({ context }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const rows = await runAsSystem("list agent blueprints", () =>
            deps.prisma.agentBlueprint.findMany({
              where: { organizationId },
              orderBy: { createdAt: "asc" },
            }),
          );
          return rows.map(blueprintView);
        }),
        create: authed.cms.blueprints.create.handler(async ({ context, input }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          // The organization's default Space has the organization's id, as for its documents.
          const row = await runAsSystem("create an agent blueprint", () =>
            deps.prisma.agentBlueprint.create({
              data: {
                organizationId,
                spaceId: organizationId,
                createdByUserId: context.actor.userId,
                name: input.name,
                description: input.description,
                instructions: input.instructions,
                referenceNames: input.referenceNames,
              },
            }),
          );
          await audit(context.actor.userId, organizationId, "agent_blueprint.created", {
            blueprintId: row.id,
            name: row.name,
          });
          return blueprintView(row);
        }),
        update: authed.cms.blueprints.update.handler(async ({ context, input }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const row = await runAsSystem("update an agent blueprint", async () => {
            const found = await deps.prisma.agentBlueprint.findFirst({
              where: { id: input.id, organizationId },
              select: { id: true },
            });
            if (!found) return null;
            return deps.prisma.agentBlueprint.update({
              where: { id: found.id },
              data: {
                name: input.name,
                description: input.description,
                instructions: input.instructions,
                referenceNames: input.referenceNames,
              },
            });
          });
          if (!row) throw new ORPCError("NOT_FOUND");
          await audit(context.actor.userId, organizationId, "agent_blueprint.updated", {
            blueprintId: row.id,
            name: row.name,
          });
          return blueprintView(row);
        }),
        // Bots made from the blueprint keep their own text; they simply stop following it.
        delete: authed.cms.blueprints.delete.handler(async ({ context, input }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const found = await runAsSystem("delete an agent blueprint", async () => {
            const row = await deps.prisma.agentBlueprint.findFirst({
              where: { id: input.id, organizationId },
              select: { id: true, name: true },
            });
            if (!row) return null;
            await deps.prisma.agentBlueprint.delete({ where: { id: row.id } });
            return row;
          });
          if (!found) throw new ORPCError("NOT_FOUND");
          await audit(context.actor.userId, organizationId, "agent_blueprint.deleted", {
            blueprintId: found.id,
            name: found.name,
          });
          return { ok: true as const };
        }),
      },
    },
  };
}

type AgentBlueprintRow = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  referenceNames: string[];
  updatedAt: Date;
};

export function blueprintView(row: AgentBlueprintRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    referenceNames: row.referenceNames,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Checks an upload's size and type, and returns the decoded bytes. Shared by every document upload. */
export function decodeOrganizationDocument(
  contentBase64: string,
  mimeType: string,
  maxBytes: number,
): { bytes: Buffer; mimeType: OrganizationDocumentMimeType } {
  // Check the encoded length before decoding, so an oversized upload is never held in memory.
  if (contentBase64.length > Math.ceil(maxBytes / 3) * 4) {
    throw new ORPCError("BAD_REQUEST", { message: "File is too large" });
  }
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new ORPCError("BAD_REQUEST", { message: "File is too large" });
  }
  if (!DOCUMENT_MIME_TYPES.has(mimeType)) {
    throw new ORPCError("BAD_REQUEST", { message: "Could not read this file" });
  }
  return { bytes, mimeType: mimeType as OrganizationDocumentMimeType };
}

/**
 * Stores the original file, records the document as processing, and queues its indexing.
 * Organization documents pass no bot; a bot's reference passes its bot and reference name.
 */
export async function storeOrganizationDocument(
  deps: RouterContext["deps"],
  userId: string,
  organizationId: string,
  input: {
    name: string;
    mimeType: OrganizationDocumentMimeType;
    bytes: Buffer;
    botId: string | null;
    referenceName: string | null;
    signal?: AbortSignal;
  },
) {
  const { name, mimeType, bytes } = input;
  const storeContext = {
    operationId: `cms-upload:${organizationId}`,
    traceId: `cms-upload:${organizationId}`,
    spaceId: organizationId,
    userId,
    signal: input.signal ?? new AbortController().signal,
  };
  // The original file is kept so processing and attachments read the same bytes.
  const stored = await deps.artifacts.put({ name, mimeType, bytes }, storeContext);
  const row = await runAsSystem("store an organization document", () =>
    deps.prisma.organizationDocument.create({
      data: {
        organizationId,
        spaceId: organizationId,
        name,
        mimeType,
        sizeBytes: bytes.length,
        content: null,
        status: "processing",
        artifactStorageId: stored.id,
        createdByUserId: userId,
        botId: input.botId,
        referenceName: input.referenceName,
      },
    }),
  );
  await deps.jobs.enqueue(organizationDocumentProcessJob(row.id)).catch((error: unknown) => {
    getLogger().error("organization document job enqueue", error);
  });
  await audit(userId, organizationId, "organization_document.uploaded", {
    documentId: row.id,
    documentName: name,
    sizeBytes: bytes.length,
  });
  return row;
}

/** Deletes documents with their chunks, then their stored files. A failed file removal is logged only. */
export async function removeOrganizationDocuments(
  deps: RouterContext["deps"],
  organizationId: string,
  userId: string,
  rows: Array<{ id: string; artifactStorageId: string | null }>,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  if (rows.length === 0) return;
  const ids = rows.map((row) => row.id);
  await runAsSystem("delete organization documents", () =>
    deps.prisma.$transaction([
      deps.prisma.organizationDocumentChunk.deleteMany({ where: { documentId: { in: ids } } }),
      deps.prisma.organizationDocument.deleteMany({ where: { id: { in: ids } } }),
    ]),
  );
  for (const row of rows) {
    if (!row.artifactStorageId) continue;
    await deps.artifacts
      .remove(row.artifactStorageId, {
        operationId: `cms-delete:${row.id}`,
        traceId: `cms-delete:${row.id}`,
        spaceId: organizationId,
        userId,
        signal: options.signal ?? new AbortController().signal,
      })
      .catch((error: unknown) => {
        getLogger().error("organization document file removal", error);
      });
  }
}

/** Admin actions are audited by name and identifiers only; document content never enters the log. */
async function audit(
  userId: string,
  organizationId: string,
  action:
    | "organization_document.uploaded"
    | "organization_document.deleted"
    | "organization_document.announced"
    | "agent_blueprint.created"
    | "agent_blueprint.updated"
    | "agent_blueprint.deleted"
    | "organization_policy.changed"
    | "organization_model_policy.changed"
    | "credential.created"
    | "credential.changed"
    | "credential.deleted",
  metadata: Required<AuditEventInput>["metadata"],
): Promise<void> {
  await recordAuditEvent({
    action,
    actor: { type: "user", id: userId },
    organizationId,
    metadata,
  });
}

type OrganizationModelRow = {
  provider: string | null;
  modelId: string | null;
  baseUrl: string | null;
  credentialCipher: string | null;
  restrictMemberProviders: boolean;
  allowedProviders: string[];
};

function settingsView(row: OrganizationModelRow | null) {
  const connected = Boolean(row?.credentialCipher);
  return {
    connected,
    provider: connected ? (row?.provider ?? null) : null,
    modelId: connected ? (row?.modelId ?? null) : null,
    baseUrl: connected ? (row?.baseUrl ?? null) : null,
    restrictMemberProviders: row?.restrictMemberProviders ?? false,
    allowedProviders: row?.allowedProviders ?? [],
  };
}

/** The organization model is one connection; its key is encrypted under the organization's record. */
function organizationModelRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const readRow = (organizationId: string) =>
    runAsSystem("read the organization model", () =>
      deps.prisma.organizationModelSettings.findUnique({ where: { organizationId } }),
    );
  return {
    get: authed.cms.models.get.handler(async ({ context }) => {
      const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
      return settingsView(await readRow(organizationId));
    }),
    catalog: authed.cms.models.catalog.handler(async ({ context }) => {
      await requireOrgAdmin(deps.prisma, context.actor);
      return ctx.unrestrictedChatCatalog(context.actor);
    }),
    probe: authed.cms.models.probe.handler(async ({ context, input }) => {
      await requireOrgAdmin(deps.prisma, context.actor);
      try {
        if (input.provider === OPENAI_COMPATIBLE_PROVIDER_ID) {
          if (!input.baseUrl) throw new Error("Enter the server address");
          const models = await probeOpenAiCompatibleModels(
            { baseUrl: input.baseUrl, apiKey: input.apiKey || undefined, headers: input.headers },
            isOllamaCloudBaseUrl(input.baseUrl) ? deps.modelConnectionFetch : undefined,
            context.signal,
            { allowPrivate: mayUsePrivateEndpoint(deps) },
          );
          return { models };
        }
        if (!input.apiKey) throw new Error("Enter an API key");
        const models = await probeCatalogProviderModels(
          { provider: input.provider, apiKey: input.apiKey },
          deps.modelConnectionFetch,
          context.signal,
        );
        return { models };
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Could not list models",
        });
      }
    }),
    connect: authed.cms.models.connect.handler(async ({ context, input }) => {
      const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
      const compatible = input.provider === OPENAI_COMPATIBLE_PROVIDER_ID;
      if (!usableModelId(input.modelId))
        throw new ORPCError("BAD_REQUEST", { message: "Choose a model" });
      // The member's connection rules apply unchanged; only the owner and the storage differ.
      const connection: ModelConnectInput = { ...input, credentialId: null };
      // Verified before anything is saved, as a member's own connection is.
      let plaintext: string;
      try {
        plaintext = buildModelConnectPlaintext(connection, undefined, {
          allowPrivateEndpoint: mayUsePrivateEndpoint(deps),
        });
        const saved = parseModelSecret(plaintext);
        if (saved.kind === "openai_compatible") {
          await verifyOpenAiCompatibleApiKey(saved, deps.modelConnectionFetch, context.signal);
        } else if (saved.kind === "api_key" && connection.apiKey) {
          await verifyCatalogProviderApiKey(
            { provider: input.provider, apiKey: connection.apiKey },
            deps.modelConnectionFetch,
            context.signal,
          );
        } else {
          throw new Error("Enter an API key");
        }
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Invalid model connection",
        });
      }
      const recordId = organizationModelRecord(organizationId);
      const stored = await deps.secrets.put(
        plaintext,
        {
          operationId: `cms-model:${organizationId}`,
          traceId: `cms-model:${organizationId}`,
          spaceId: organizationId,
          userId: context.actor.userId,
          signal: context.signal ?? new AbortController().signal,
        },
        { recordId },
      );
      const previous = await readRow(organizationId);
      const data = {
        spaceId: organizationId,
        provider: input.provider,
        modelId: usableModelId(input.modelId),
        baseUrl: compatible ? (input.baseUrl ?? null) : null,
        credentialCipher: stored.ciphertext,
        updatedByUserId: context.actor.userId,
      };
      const row = await runAsSystem("save the organization model", () =>
        deps.prisma.organizationModelSettings.upsert({
          where: { organizationId },
          create: { organizationId, ...data },
          update: data,
        }),
      );
      if (previous?.credentialCipher && previous.credentialCipher !== stored.ciphertext) {
        await deps.secrets.delete(previous.credentialCipher, recordId).catch(() => undefined);
      }
      await audit(
        context.actor.userId,
        organizationId,
        previous?.credentialCipher ? "credential.changed" : "credential.created",
        {
          kind: "organization_model",
          provider: input.provider,
        },
      );
      return settingsView(row);
    }),
    disconnect: authed.cms.models.disconnect.handler(async ({ context }) => {
      const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
      const previous = await readRow(organizationId);
      if (!previous?.credentialCipher) return { ok: true as const };
      await runAsSystem("remove the organization model", () =>
        deps.prisma.organizationModelSettings.update({
          where: { organizationId },
          data: {
            provider: null,
            modelId: null,
            baseUrl: null,
            credentialCipher: null,
            updatedByUserId: context.actor.userId,
          },
        }),
      );
      await deps.secrets
        .delete(previous.credentialCipher, organizationModelRecord(organizationId))
        .catch(() => undefined);
      await audit(context.actor.userId, organizationId, "credential.deleted", {
        kind: "organization_model",
        provider: previous.provider,
      });
      return { ok: true as const };
    }),
    setPolicy: authed.cms.models.setPolicy.handler(async ({ context, input }) => {
      const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
      const allowedProviders = [...new Set(input.allowedProviders)];
      const data = {
        spaceId: organizationId,
        restrictMemberProviders: input.restrictMemberProviders,
        allowedProviders,
        updatedByUserId: context.actor.userId,
      };
      const row = await runAsSystem("save the organization model policy", () =>
        deps.prisma.organizationModelSettings.upsert({
          where: { organizationId },
          create: { organizationId, ...data },
          update: data,
        }),
      );
      await audit(context.actor.userId, organizationId, "organization_model_policy.changed", {
        restrictMemberProviders: row.restrictMemberProviders,
        allowedProviderCount: row.allowedProviders.length,
      });
      return settingsView(row);
    }),
  };
}
