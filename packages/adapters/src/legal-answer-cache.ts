import { createHash, randomUUID } from "node:crypto";
import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import {
  ciphertextKeyId,
  contentEncryptionOf,
  decryptText,
  encryptText,
  exactDigest,
  LEGAL_BOT,
  runAsSystem,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { organizationIdForSpace } from "./organization-documents.js";

/** How long a cached answer is reused, even while the documents stay the same. */
export const LEGAL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A question this soon after an earlier message in the chat may lean on it, so it is not cached. */
export const LEGAL_CACHE_STANDALONE_GAP_MS = 30 * 60 * 1000;
/** Longer questions tend to carry the asker's own circumstances; they are answered fresh. */
export const LEGAL_CACHE_MAX_QUESTION_CHARS = 300;
const LEGAL_SPAWN_KEY_PREFIX = "builtin:legal";
const DIGEST_DOMAIN = "legal-question";

export interface LegalCacheKey {
  organizationId: string;
  spaceId: string;
  question: string;
  version: string;
  /**
   * No other message came shortly before the question, so its answer can be kept. A cached answer
   * is reused for the same words either way: only standalone questions are ever stored.
   */
  standalone?: boolean;
}

export interface CachedLegalAnswer {
  id: string;
  answer: string;
  documentIds: string[];
}

/** The built-in Legal bot: locked and provisioned by the organization. */
export function isLegalBot(bot: { locked?: boolean | null; spawnKey?: string | null }): boolean {
  return Boolean(bot.locked && bot.spawnKey?.startsWith(LEGAL_SPAWN_KEY_PREFIX));
}

/**
 * The question as a cache key sees it: case, spacing and punctuation do not matter, so
 * "Cara resign gimana?" and "cara  resign gimana" are the same question. Wording that differs
 * otherwise is a different question.
 */
export function normalizeLegalQuestion(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The plain text a person typed in a message, or null when it holds anything else. */
export function legalQuestionText(blocks: unknown): string | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || (block as { kind?: unknown }).kind !== "text")
      return null;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string") parts.push(text);
  }
  const question = parts.join("\n").trim();
  if (!question || question.length > LEGAL_CACHE_MAX_QUESTION_CHARS) return null;
  return normalizeLegalQuestion(question) ? question : null;
}

/**
 * What an answer was made from: the organization's ready documents (any upload, edit or delete
 * changes it) and the Legal instructions. A cached answer is reused only for the same version.
 */
export async function legalCacheVersion(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string> {
  const documents = await runAsSystem("read the Legal cache version", () =>
    prisma.organizationDocument.findMany({
      where: { organizationId, botId: null, status: "ready" },
      select: { id: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
  );
  const hash = createHash("sha256").update(LEGAL_BOT.instructions);
  for (const document of documents)
    hash.update(`\n${document.id}:${document.updatedAt.toISOString()}`);
  return hash.digest("hex");
}

/**
 * Whether the question stands on its own: no other message in the chat in the half hour before
 * it. A follow-up ("explain that again") depends on what came before and is never cached.
 */
export async function isStandaloneQuestion(
  prisma: PrismaClient,
  message: { id: string; threadId: string; createdAt: Date },
): Promise<boolean> {
  const earlier = await prisma.message.count({
    where: {
      threadId: message.threadId,
      id: { not: message.id },
      createdAt: {
        gte: new Date(message.createdAt.getTime() - LEGAL_CACHE_STANDALONE_GAP_MS),
        lte: message.createdAt,
      },
    },
  });
  return earlier === 0;
}

async function questionKey(prisma: PrismaClient, key: LegalCacheKey) {
  const encryption = contentEncryptionOf(prisma);
  if (!encryption) return null;
  const dataKey = await encryption.ring.current(key.spaceId);
  return {
    dataKey,
    digest: exactDigest(dataKey, DIGEST_DOMAIN, normalizeLegalQuestion(key.question)),
  };
}

/** The cached answer for this question and version, if one is still fresh. */
export async function lookupLegalAnswer(
  prisma: PrismaClient,
  key: LegalCacheKey,
): Promise<CachedLegalAnswer | null> {
  const lookup = await questionKey(prisma, key);
  const encryption = contentEncryptionOf(prisma);
  if (!lookup || !encryption) return null;
  return runAsSystem("read a cached Legal answer", async () => {
    const row = await prisma.legalAnswerCache.findUnique({
      where: {
        organizationId_questionKey_version: {
          organizationId: key.organizationId,
          questionKey: lookup.digest,
          version: key.version,
        },
      },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    const dataKey = await encryption.ring.byId(ciphertextKeyId(row.answer) ?? "");
    const answer = decryptText(
      dataKey,
      legalAnswerLocation(row.id, key.organizationId),
      row.answer,
    );
    await prisma.legalAnswerCache.update({
      where: { id: row.id },
      data: { hitCount: { increment: 1 } },
    });
    return { id: row.id, answer, documentIds: row.documentIds };
  });
}

/** Keeps a fresh Legal answer for later identical questions. A failure only skips the cache. */
export async function storeLegalAnswer(
  prisma: PrismaClient,
  key: LegalCacheKey,
  answer: { text: string; documentIds: string[] },
): Promise<void> {
  const text = answer.text.trim();
  if (!text) return;
  try {
    const lookup = await questionKey(prisma, key);
    if (!lookup) return;
    const id = randomUUID();
    const encrypted = encryptText(
      lookup.dataKey,
      legalAnswerLocation(id, key.organizationId),
      text,
    );
    await runAsSystem("cache a Legal answer", () =>
      prisma.legalAnswerCache.upsert({
        where: {
          organizationId_questionKey_version: {
            organizationId: key.organizationId,
            questionKey: lookup.digest,
            version: key.version,
          },
        },
        // A concurrent identical question may have stored one first; that answer stays.
        update: {},
        create: {
          id,
          organizationId: key.organizationId,
          spaceId: lookup.dataKey.spaceId,
          questionKey: lookup.digest,
          version: key.version,
          answer: encrypted,
          documentIds: [...new Set(answer.documentIds)],
          expiresAt: new Date(Date.now() + LEGAL_CACHE_TTL_MS),
        },
      }),
    );
  } catch (error) {
    getLogger().error("cache a Legal answer", error);
  }
}

function legalAnswerLocation(rowId: string, organizationId: string) {
  return { table: "legal_answer_cache", column: "answer", rowId, owner: organizationId };
}

/**
 * Replays a cached answer as a run would have produced it: the cited documents are attached
 * again through the same tool, then the answer is posted. No model is called.
 */
export async function* replayLegalAnswer(
  runId: string,
  cached: CachedLegalAnswer,
): AsyncIterable<AgentRuntimeEvent> {
  for (const [index, documentId] of cached.documentIds.entries()) {
    yield {
      type: "tool",
      name: "attach_company_document",
      args: { documentId },
      executionId: `${runId}:legal-cache:attach:${index}`,
    };
  }
  yield { type: "text", text: cached.answer };
  yield { type: "done", text: cached.answer };
}

/** What a live Legal run did, read off its events so a good answer can be cached afterwards. */
export interface LegalRunObservation {
  searched: boolean;
  documentIds: string[];
  finalText: string;
}

/** Passes the runtime's events through unchanged while noting what the run searched, attached and said. */
export async function* observeLegalRun(
  events: AsyncIterable<AgentRuntimeEvent>,
  observation: LegalRunObservation,
): AsyncIterable<AgentRuntimeEvent> {
  let turnText = "";
  for await (const event of events) {
    if (event.type === "turn") turnText = "";
    if (event.type === "text") turnText += event.text;
    if (event.type === "tool") {
      if (event.name === "company_documents_search") observation.searched = true;
      if (event.name === "attach_company_document" && typeof event.args.documentId === "string")
        observation.documentIds.push(event.args.documentId);
    }
    if (event.type === "done") observation.finalText = event.text || turnText;
    yield event;
  }
}

/**
 * The cache key for a Legal run, or null when this run must be answered fresh: not a person's
 * own short text question, or the cache cannot be read. Never throws.
 */
export async function legalCacheKeyFor(
  prisma: PrismaClient,
  run: { spaceId: string },
  message: { id: string; threadId: string; createdAt: Date; blocks: unknown },
): Promise<LegalCacheKey | null> {
  try {
    const question = legalQuestionText(message.blocks);
    if (!question) return null;
    const organizationId = await organizationIdForSpace(prisma, run.spaceId);
    if (!organizationId) return null;
    return {
      organizationId,
      // The organization's documents and their encryption key live under its default Space.
      spaceId: organizationId,
      question,
      version: await legalCacheVersion(prisma, organizationId),
      standalone: await isStandaloneQuestion(prisma, message),
    };
  } catch (error) {
    getLogger().error("Legal cache key", error);
    return null;
  }
}
