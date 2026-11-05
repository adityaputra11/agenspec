import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { ORGANIZATION_DOCUMENT_PATH_PREFIX } from "@rakazo/memory";

export type OrganizationDocumentMimeType = "application/pdf" | "text/plain" | "text/markdown";

/** Plain text from an uploaded file; PDFs are parsed only when a PDF is uploaded. */
export async function extractDocumentText(
  mimeType: OrganizationDocumentMimeType,
  bytes: Uint8Array,
): Promise<string> {
  if (mimeType === "application/pdf") {
    const { extractText } = await import("unpdf");
    const { text } = await extractText(bytes, { mergePages: true });
    return text.trim();
  }
  return new TextDecoder().decode(bytes).trim();
}

/** The memory path that holds one organization document in every Space of the organization. */
export function organizationDocumentMemoryPath(documentId: string): string {
  return `${ORGANIZATION_DOCUMENT_PATH_PREFIX}${documentId}.md`;
}

/**
 * Writes (or removes, when `document` is null) the bot-readable copy of an organization
 * document in every Space of the organization. The copy belongs to each Space's creator, which
 * is the user the Space's memory reads are scoped to.
 */
export async function syncOrganizationDocument(
  prisma: PrismaClient,
  organizationId: string,
  document: { name: string; content: string } | null,
  documentId: string,
  fallbackUserId: string,
): Promise<void> {
  const path = organizationDocumentMemoryPath(documentId);
  await runAsSystem("sync an organization document to bot memory", async () => {
    const spaces = await prisma.space.findMany({
      where: { organizationId },
      select: { id: true, createdByUserId: true },
    });
    for (const space of spaces) {
      const existing = await prisma.memoryDocument.findFirst({
        where: { spaceId: space.id, scope: "user", botId: null, path },
      });
      if (!document) {
        // Revisions cascade with the document row.
        if (existing) await prisma.memoryDocument.delete({ where: { id: existing.id } });
        continue;
      }
      const content = `# ${document.name}\n\n${document.content}`;
      if (existing) {
        const updated = await prisma.memoryDocument.update({
          where: { id: existing.id },
          data: { content, revision: existing.revision + 1 },
        });
        await prisma.memoryRevision.create({
          data: { documentId: updated.id, revision: updated.revision, content },
        });
      } else {
        const created = await prisma.memoryDocument.create({
          data: {
            spaceId: space.id,
            userId: space.createdByUserId ?? fallbackUserId,
            scope: "user",
            path,
            content,
          },
        });
        await prisma.memoryRevision.create({
          data: { documentId: created.id, revision: created.revision, content },
        });
      }
    }
  });
}
