import { randomUUID } from "node:crypto";
import type { AdapterContext, ArtifactStore } from "@rakazo/adapter-kit";
import { chunkOrganizationDocument } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import {
  ciphertextKeyId,
  contentEncryptionOf,
  decryptText,
  encryptText,
  runAsSystem,
  searchTokens,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

export type OrganizationDocumentMimeType = "application/pdf" | "text/plain" | "text/markdown";

export const ORGANIZATION_DOCUMENT_MAX_CHUNKS = 2_000;
export const ORGANIZATION_EXTRACT_TIMEOUT_MS = 60_000;
/** Results a search decrypts at most, and the excerpt size each result returns. */
export const COMPANY_SEARCH_MAX_CANDIDATES = 50;
export const COMPANY_EXCERPT_MAX_CHARS = 1_200;
/** Index rows read per query before ranking; a bound on the database work, not on results. */
const COMPANY_SEARCH_MAX_INDEX_ROWS = 500;

/** Plain text from an uploaded file. `unpdf` loads only when a PDF is processed. */
export async function extractOrganizationDocumentText(
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

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** The short reason a failed document shows its admin; never the content. */
function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Document has more than")) return message;
  if (message.includes("timed out")) return "Reading this file took too long.";
  if (message.startsWith("No text")) return message;
  return "Could not read this file.";
}

/**
 * Extracts, chunks and indexes one organization document. Chunks are encrypted with the
 * organization's default space key and carry blind-index tokens. Idempotent per document: a
 * retry replaces earlier chunks. Failures are recorded on the document, not thrown.
 */
export async function processOrganizationDocument(
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  documentId: string,
): Promise<void> {
  const row = await runAsSystem("index an organization document", () =>
    deps.prisma.organizationDocument.findUnique({ where: { id: documentId } }),
  );
  if (!row || row.status !== "processing" || !row.artifactStorageId) return;
  const encryption = contentEncryptionOf(deps.prisma);
  try {
    if (!encryption) throw new Error("Content encryption is not configured");
    const spaceId = row.spaceId ?? row.organizationId;
    const context: AdapterContext = {
      operationId: `organization-document:${row.id}`,
      traceId: `organization-document:${row.id}`,
      spaceId,
      userId: row.createdByUserId,
      signal: new AbortController().signal,
    };
    const bytes = await deps.artifacts.get(row.artifactStorageId, context);
    const text = await withTimeout(
      extractOrganizationDocumentText(row.mimeType as OrganizationDocumentMimeType, bytes),
      ORGANIZATION_EXTRACT_TIMEOUT_MS,
      "Reading this file timed out",
    );
    const sections = chunkOrganizationDocument(text);
    if (sections.length === 0) throw new Error("No text found in this file");
    if (sections.length > ORGANIZATION_DOCUMENT_MAX_CHUNKS)
      throw new Error(`Document has more than ${ORGANIZATION_DOCUMENT_MAX_CHUNKS} sections`);
    const key = await encryption.ring.current(spaceId);
    const rows = sections.map((section) => {
      const id = randomUUID();
      const location = {
        table: "organization_document_chunks",
        column: "content",
        rowId: id,
        owner: row.id,
      };
      return {
        id,
        spaceId: key.spaceId,
        documentId: row.id,
        organizationId: row.organizationId,
        botId: row.botId,
        ordinal: section.ordinal,
        heading: section.heading,
        content: encryptText(key, location, section.content),
        searchTokens: searchTokens(key, {
          words: `${section.heading}\n${section.content}`,
          strings: [],
        }),
      };
    });
    await runAsSystem("store organization document sections", () =>
      deps.prisma.$transaction(async (tx) => {
        await tx.organizationDocumentChunk.deleteMany({ where: { documentId: row.id } });
        await tx.organizationDocumentChunk.createMany({ data: rows });
        await tx.organizationDocument.update({
          where: { id: row.id },
          data: { status: "ready", chunkCount: rows.length, error: null },
        });
      }),
    );
  } catch (error) {
    getLogger().error("organization document processing failed", error, {
      "organization.document.id": documentId,
    });
    await runAsSystem("mark an organization document failed", () =>
      deps.prisma.organizationDocument.update({
        where: { id: documentId },
        data: { status: "failed", error: failureReason(error).slice(0, 200) },
      }),
    );
  }
}

export interface CompanyCandidate {
  id: string;
  ordinal: number;
  /** Distinct query tokens the chunk contains. */
  matched: number;
}

/**
 * Ranks chunks by how many distinct query tokens they hold, most first, then by document order.
 * Chunks with no match are dropped. Pure, so the ordering is testable without a database.
 */
export function rankCompanyCandidates(
  chunks: Array<{ id: string; ordinal: number; searchTokens: number[] }>,
  queryTokens: readonly number[],
  limit = COMPANY_SEARCH_MAX_CANDIDATES,
): CompanyCandidate[] {
  const wanted = new Set(queryTokens);
  return chunks
    .map((chunk) => ({
      id: chunk.id,
      ordinal: chunk.ordinal,
      matched: new Set(chunk.searchTokens.filter((token) => wanted.has(token))).size,
    }))
    .filter((candidate) => candidate.matched > 0)
    .sort((a, b) => b.matched - a.matched || a.ordinal - b.ordinal)
    .slice(0, limit);
}

export interface CompanySearchResult {
  ref: string;
  documentId: string;
  documentName: string;
  /** The blueprint slot the document fills, when it is a bot's reference document. */
  referenceName?: string;
  heading: string;
  excerpt: string;
}

/**
 * The documents a search, attach or availability check may read: the organization's own (botId
 * NULL), plus one bot's reference documents when a bot asks. No bot ever reads another bot's.
 */
export function companyScope(
  botId: string | undefined,
): { botId: null } | { OR: Array<{ botId: string | null }> } {
  return botId ? { OR: [{ botId: null }, { botId }] } : { botId: null };
}

/**
 * Searches the ready documents of one organization. Tokens come from every key version of the
 * default space, so older chunks stay findable after a rotation. Only documents of
 * `organizationId` are considered, and of those only the organization's own documents and, when
 * `botId` is given, that bot's reference documents.
 */
export async function searchCompanyDocuments(
  prisma: PrismaClient,
  input: { organizationId: string; query: string; limit: number; botId?: string },
): Promise<CompanySearchResult[]> {
  const encryption = contentEncryptionOf(prisma);
  if (!encryption) return [];
  const tokenSets = await encryption.messageSearchTokens(input.organizationId, input.query, "word");
  const queryTokens = [...new Set(tokenSets.flat())];
  if (queryTokens.length === 0) return [];
  return runAsSystem("search organization documents", async () => {
    const indexed = await prisma.organizationDocumentChunk.findMany({
      where: {
        organizationId: input.organizationId,
        searchTokens: { hasSome: queryTokens },
        ...companyScope(input.botId),
      },
      select: { id: true, documentId: true, ordinal: true, searchTokens: true },
      orderBy: { createdAt: "desc" },
      take: COMPANY_SEARCH_MAX_INDEX_ROWS,
    });
    const ranked = rankCompanyCandidates(indexed, queryTokens, COMPANY_SEARCH_MAX_CANDIDATES);
    if (ranked.length === 0) return [];
    // Checked on the document too: chunks written before a document had a bot owner carry no botId.
    const documents = await prisma.organizationDocument.findMany({
      where: {
        id: { in: [...new Set(indexed.map((row) => row.documentId))] },
        organizationId: input.organizationId,
        status: "ready",
        ...companyScope(input.botId),
      },
      select: { id: true, name: true, referenceName: true },
    });
    const documentsById = new Map(documents.map((doc) => [doc.id, doc]));
    const rows = await prisma.organizationDocumentChunk.findMany({
      where: { id: { in: ranked.map((candidate) => candidate.id) } },
      select: { id: true, documentId: true, ordinal: true, heading: true, content: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const results: CompanySearchResult[] = [];
    for (const candidate of ranked) {
      const row = byId.get(candidate.id);
      const document = row ? documentsById.get(row.documentId) : undefined;
      if (!row || !document) continue;
      const key = await encryption.ring.byId(ciphertextKeyId(row.content) ?? "");
      const text = decryptText(
        key,
        {
          table: "organization_document_chunks",
          column: "content",
          rowId: row.id,
          owner: row.documentId,
        },
        row.content,
      );
      results.push({
        ref: `${row.documentId}#${row.ordinal}`,
        documentId: row.documentId,
        documentName: document.name,
        ...(document.referenceName ? { referenceName: document.referenceName } : {}),
        heading: row.heading,
        excerpt: text.slice(0, COMPANY_EXCERPT_MAX_CHARS),
      });
      if (results.length >= input.limit) break;
    }
    return results;
  });
}

/**
 * Whether the organization has at least one document ready to search, counting a bot's own
 * reference documents when `botId` is given.
 */
export async function organizationHasReadyDocuments(
  prisma: PrismaClient,
  organizationId: string,
  botId?: string,
): Promise<boolean> {
  const count = await runAsSystem("check organization documents", () =>
    prisma.organizationDocument.count({
      where: { organizationId, status: "ready", ...companyScope(botId) },
    }),
  );
  return count > 0;
}

/** The organization a Space belongs to, or null for a Space that was removed. */
export async function organizationIdForSpace(
  prisma: PrismaClient,
  spaceId: string,
): Promise<string | null> {
  const space = await runAsSystem("read a space's organization", () =>
    prisma.space.findUnique({ where: { id: spaceId }, select: { organizationId: true } }),
  );
  return space?.organizationId ?? null;
}

/**
 * Whether a Space's organization has at least one ready document to search or attach, or the
 * running bot has one of its own. A failed check hides the company tools for the run instead of
 * failing the run.
 */
export async function organizationHasReadyDocumentsForSpace(
  prisma: PrismaClient,
  spaceId: string,
  botId?: string,
): Promise<boolean> {
  try {
    const organizationId = await organizationIdForSpace(prisma, spaceId);
    return organizationId
      ? await organizationHasReadyDocuments(prisma, organizationId, botId)
      : false;
  } catch (error) {
    getLogger().error("organization document availability", error, { "space.id": spaceId });
    return false;
  }
}

/**
 * A ready document of exactly this organization, or null. Any other organization's document,
 * even one that exists, is refused the same way as a missing one.
 */
export async function readyCompanyDocument(
  prisma: PrismaClient,
  input: { organizationId: string; documentId: string; botId?: string },
): Promise<{ id: string; name: string; mimeType: string; artifactStorageId: string } | null> {
  const row = await runAsSystem("read an organization document for a chat", () =>
    prisma.organizationDocument.findFirst({
      where: {
        id: input.documentId,
        organizationId: input.organizationId,
        status: "ready",
        ...companyScope(input.botId),
      },
      select: { id: true, name: true, mimeType: true, artifactStorageId: true },
    }),
  );
  return row?.artifactStorageId
    ? {
        id: row.id,
        name: row.name,
        mimeType: row.mimeType,
        artifactStorageId: row.artifactStorageId,
      }
    : null;
}

/** A blueprint's instructions and, per named slot, the bot's latest reference document for it. */
export interface BotBlueprint {
  instructions: string;
  references: Array<{ referenceName: string; document: { name: string; status: string } | null }>;
}

/**
 * The blueprint a bot was made from, or null when it was deleted or belongs to another
 * organization than the bot's Space. Only the bot's own reference documents are read.
 */
export async function blueprintForBot(
  prisma: PrismaClient,
  input: { spaceId: string; botId: string; blueprintId: string },
): Promise<BotBlueprint | null> {
  const [organizationId, documents] = await Promise.all([
    organizationIdForSpace(prisma, input.spaceId),
    runAsSystem("read a bot's reference documents", () =>
      prisma.organizationDocument.findMany({
        where: { botId: input.botId, referenceName: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { referenceName: true, name: true, status: true },
      }),
    ),
  ]);
  if (!organizationId) return null;
  const blueprint = await runAsSystem("read a bot's blueprint", () =>
    prisma.agentBlueprint.findFirst({
      where: { id: input.blueprintId, organizationId },
      select: { instructions: true, referenceNames: true },
    }),
  );
  if (!blueprint) return null;
  const latest = new Map<string, { name: string; status: string }>();
  for (const doc of documents) {
    if (doc.referenceName && !latest.has(doc.referenceName))
      latest.set(doc.referenceName, { name: doc.name, status: doc.status });
  }
  return {
    instructions: blueprint.instructions,
    references: blueprint.referenceNames.map((referenceName) => ({
      referenceName,
      document: latest.get(referenceName) ?? null,
    })),
  };
}
