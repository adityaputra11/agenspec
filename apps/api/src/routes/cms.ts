import { ORPCError } from "@orpc/server";
import { attachmentMaxBytes } from "@rakazo/contracts";
import { orgAdminRoles, orgAppPolicyFor, orgMembershipOf, requireOrgAdmin } from "../org-admin.js";
import type { OrganizationDocumentMimeType } from "../org-documents.js";
import { extractDocumentText, syncOrganizationDocument } from "../org-documents.js";
import type { RouterContext } from "./context.js";

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
          return saved;
        }),
      },
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
          const rows = await deps.prisma.organizationDocument.findMany({
            where: { organizationId },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
          });
          return rows.map((row) => ({
            id: row.id,
            name: row.name,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            createdAt: row.createdAt.toISOString(),
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
          const mimeType = input.mimeType as OrganizationDocumentMimeType;
          let content: string;
          try {
            content = await extractDocumentText(mimeType, bytes);
          } catch {
            throw new ORPCError("BAD_REQUEST", { message: "Could not read this file" });
          }
          if (!content) {
            throw new ORPCError("BAD_REQUEST", { message: "No text found in this file" });
          }
          const name = input.name.trim();
          const row = await deps.prisma.organizationDocument.create({
            data: {
              organizationId,
              name,
              mimeType,
              sizeBytes: bytes.length,
              content,
              createdByUserId: context.actor.userId,
            },
          });
          await syncOrganizationDocument(
            deps.prisma,
            organizationId,
            { name, content },
            row.id,
            context.actor.userId,
          );
          return {
            id: row.id,
            name: row.name,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            createdAt: row.createdAt.toISOString(),
          };
        }),
        delete: authed.cms.documents.delete.handler(async ({ context, input }) => {
          const organizationId = await requireOrgAdmin(deps.prisma, context.actor);
          const row = await deps.prisma.organizationDocument.findFirst({
            where: { id: input.id, organizationId },
            select: { id: true },
          });
          if (!row) throw new ORPCError("NOT_FOUND");
          await deps.prisma.organizationDocument.delete({ where: { id: row.id } });
          await syncOrganizationDocument(
            deps.prisma,
            organizationId,
            null,
            row.id,
            context.actor.userId,
          );
          return { ok: true as const };
        }),
      },
    },
  };
}
