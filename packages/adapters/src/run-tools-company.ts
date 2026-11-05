import { messageBlockForArtifact } from "@rakazo/core";
import { runAsSystem } from "@rakazo/db";
import {
  organizationIdForSpace,
  readyCompanyDocument,
  searchCompanyDocuments,
} from "./organization-documents.js";
import { publishMessage } from "./run-messages.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import { attachWorkspaceFileToThread } from "./thread-artifacts.js";

const SEARCH_DEFAULT_LIMIT = 5;
const SEARCH_MAX_LIMIT = 8;
const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
};

/** The file name an attachment carries: the document name with an extension its type needs. */
export function companyAttachmentFileName(name: string, mimeType: string): string {
  const base = name.replace(/[\\/]/g, "-").trim() || "document";
  const extension = EXTENSION_BY_MIME[mimeType] ?? "";
  return extension && !base.toLowerCase().endsWith(extension) ? `${base}${extension}` : base;
}

/** Organization documents for the bot's organization: search and attach, nothing else. */
export const companyTools: ToolHandlers = {
  async company_documents_search(ctx, call) {
    const { deps, run, bot } = ctx;
    const query = String(call.args.query ?? "").trim();
    if (!query) return call.finish({ error: "query is required" });
    const requested = Number(call.args.limit);
    const limit = Number.isFinite(requested)
      ? Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.floor(requested)))
      : SEARCH_DEFAULT_LIMIT;
    const organizationId = await organizationIdForSpace(deps.prisma, run.spaceId);
    if (!organizationId) return call.finish({ results: [] });
    const results = await searchCompanyDocuments(deps.prisma, {
      organizationId,
      query,
      limit,
      botId: bot.id,
    });
    return call.finish({ results });
  },
  async attach_company_document(ctx, call) {
    const { deps, run, bot, thread, context } = ctx;
    const documentId = String(call.args.documentId ?? "");
    const fail = (error: string) => call.finish({ error });
    if (!deps.artifacts) return fail("artifact storage unavailable");
    const organizationId = await organizationIdForSpace(deps.prisma, run.spaceId);
    const document = organizationId
      ? await readyCompanyDocument(deps.prisma, { organizationId, documentId, botId: bot.id })
      : null;
    if (!document) return fail("document not found or not ready");
    // A document stored for this chat before is shown again from that copy rather than stored
    // twice. Its earlier card may be gone (a cleared chat), so the card is always posted.
    const attachedBefore = await runAsSystem("check a chat's attachments", async () => {
      const runs = await deps.prisma.run.findMany({
        where: { threadId: thread.id },
        select: { id: true },
      });
      return deps.prisma.artifact.findFirst({
        where: {
          spaceId: run.spaceId,
          runId: { in: runs.map((item) => item.id) },
          name: document.name,
        },
        select: { id: true, name: true, mimeType: true, size: true },
      });
    });
    if (attachedBefore) {
      await publishMessage(deps, run, "bot", [messageBlockForArtifact(attachedBefore)]);
      return call.finish({ ok: true, artifactId: attachedBefore.id });
    }
    const bytes = await deps.artifacts.get(document.artifactStorageId, context);
    try {
      const attached = await attachWorkspaceFileToThread(
        {
          prisma: deps.prisma,
          artifacts: deps.artifacts,
          maxUploadSizeBytes: deps.maxUploadSizeBytes,
        },
        {
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          groupId: thread.groupId ?? undefined,
          runId: run.id,
          filePath: companyAttachmentFileName(document.name, document.mimeType),
          bytes,
          operationId: call.executionId,
          name: document.name,
        },
      );
      await publishMessage(deps, run, "bot", [attached.block]);
      return call.finish({ ok: true, artifactId: attached.artifactId });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "could not attach document");
    }
  },
};
