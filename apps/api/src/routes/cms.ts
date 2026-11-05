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
              where: { organizationId },
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
          const maxBytes = attachmentMaxBytes(deps.env);
          // Check the encoded length before decoding, so an oversized upload is never held in memory.
          if (input.contentBase64.length > Math.ceil(maxBytes / 3) * 4) {
            throw new ORPCError("BAD_REQUEST", { message: "File is too large" });
          }
          const bytes = Buffer.from(input.contentBase64, "base64");
          if (bytes.length === 0 || bytes.length > maxBytes) {
            throw new ORPCError("BAD_REQUEST", { message: "File is too large" });
          }
          if (!DOCUMENT_MIME_TYPES.has(input.mimeType)) {
            throw new ORPCError("BAD_REQUEST", { message: "Could not read this file" });
          }
          const mimeType = input.mimeType as OrganizationDocumentMimeType;
          const name = input.name.trim();
          const storeContext = {
            operationId: `cms-upload:${organizationId}`,
            traceId: `cms-upload:${organizationId}`,
            spaceId: organizationId,
            userId: context.actor.userId,
            signal: context.signal ?? new AbortController().signal,
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
                createdByUserId: context.actor.userId,
              },
            }),
          );
          await deps.jobs
            .enqueue(organizationDocumentProcessJob(row.id))
            .catch((error: unknown) => {
              getLogger().error("organization document job enqueue", error);
            });
          await audit(context.actor.userId, organizationId, "organization_document.uploaded", {
            documentId: row.id,
            documentName: name,
            sizeBytes: bytes.length,
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
              where: { id: input.id, organizationId, status: "ready" },
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
          const row = await runAsSystem("delete an organization document", async () => {
            const found = await deps.prisma.organizationDocument.findFirst({
              where: { id: input.id, organizationId },
              select: { id: true, name: true, artifactStorageId: true },
            });
            if (!found) return null;
            await deps.prisma.$transaction([
              deps.prisma.organizationDocumentChunk.deleteMany({ where: { documentId: found.id } }),
              deps.prisma.organizationDocument.delete({ where: { id: found.id } }),
            ]);
            return found;
          });
          if (!row) throw new ORPCError("NOT_FOUND");
          if (row.artifactStorageId) {
            await deps.artifacts
              .remove(row.artifactStorageId, {
                operationId: `cms-delete:${row.id}`,
                traceId: `cms-delete:${row.id}`,
                spaceId: organizationId,
                userId: context.actor.userId,
                signal: context.signal ?? new AbortController().signal,
              })
              .catch((error: unknown) => {
                getLogger().error("organization document file removal", error);
              });
          }
          await audit(context.actor.userId, organizationId, "organization_document.deleted", {
            documentId: row.id,
            documentName: row.name,
          });
          return { ok: true as const };
        }),
      },
    },
  };
}

/** Admin actions are audited by name and identifiers only; document content never enters the log. */
async function audit(
  userId: string,
  organizationId: string,
  action:
    | "organization_document.uploaded"
    | "organization_document.deleted"
    | "organization_document.announced"
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
