import { randomBytes } from "node:crypto";
import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type { LegalRunObservation } from "./legal-answer-cache.js";
import {
  isLegalBot,
  legalQuestionText,
  lookupLegalAnswer,
  normalizeLegalQuestion,
  observeLegalRun,
  replayLegalAnswer,
  storeLegalAnswer,
} from "./legal-answer-cache.js";

const key = { id: "key-1", spaceId: "org-1", version: 1, key: randomBytes(32) };
const otherKey = { id: "key-2", spaceId: "org-2", version: 1, key: randomBytes(32) };

/** One in-memory cache table behind the encryption ring of the given data keys. */
function fakePrisma(current = key) {
  const rows = new Map<string, Record<string, unknown>>();
  const unique = (where: Record<string, Record<string, string>>) => {
    const k = where.organizationId_questionKey_version;
    return `${k?.organizationId}|${k?.questionKey}|${k?.version}`;
  };
  return {
    rows,
    prisma: {
      $contentEncryption: () => ({
        ring: {
          current: async () => current,
          byId: async (id: string) => [key, otherKey].find((candidate) => candidate.id === id),
        },
      }),
      legalAnswerCache: {
        findUnique: vi.fn(async ({ where }) => rows.get(unique(where)) ?? null),
        upsert: vi.fn(async ({ where, create }) => {
          const id = unique(where);
          if (!rows.has(id)) rows.set(id, { ...create });
          return rows.get(id);
        }),
        update: vi.fn(async () => ({})),
      },
    },
  };
}

const cacheKey = {
  organizationId: "org-1",
  spaceId: "org-1",
  question: "Cara resign gimana?",
  version: "v1",
};

describe("Legal answer cache", () => {
  it("treats case, spacing and punctuation as the same question, and other words as different", () => {
    expect(normalizeLegalQuestion("  Cara RESIGN, gimana?? ")).toBe(
      normalizeLegalQuestion("cara resign gimana"),
    );
    expect(normalizeLegalQuestion("cara resign gimana")).not.toBe(
      normalizeLegalQuestion("cara mengundurkan diri gimana"),
    );
  });

  it("only caches a short, text-only question", () => {
    expect(legalQuestionText([{ kind: "text", text: "Cuti tahunan berapa hari?" }])).toBe(
      "Cuti tahunan berapa hari?",
    );
    expect(
      legalQuestionText([{ kind: "image", artifactId: "a", name: "x.png", mimeType: "image/png" }]),
    ).toBeNull();
    expect(legalQuestionText([{ kind: "text", text: "x".repeat(301) }])).toBeNull();
    expect(legalQuestionText([{ kind: "text", text: "??" }])).toBeNull();
  });

  it("recognizes only the organization's locked Legal bot", () => {
    expect(isLegalBot({ locked: true, spawnKey: "builtin:legal:user-1" })).toBe(true);
    expect(isLegalBot({ locked: false, spawnKey: "builtin:legal:user-1" })).toBe(false);
    expect(isLegalBot({ locked: true, spawnKey: "builtin:other" })).toBe(false);
  });

  it("returns a stored answer for the same question and version only, encrypted at rest", async () => {
    const { prisma, rows } = fakePrisma();
    await storeLegalAnswer(prisma as never, cacheKey, {
      text: "Ajukan surat 30 hari sebelumnya (Pasal 28).",
      documentIds: ["doc-1", "doc-1"],
    });
    const [stored] = [...rows.values()];
    expect(String(stored?.answer)).not.toContain("Pasal 28");
    expect(String(stored?.questionKey)).not.toContain("resign");

    const hit = await lookupLegalAnswer(prisma as never, {
      ...cacheKey,
      question: "cara RESIGN gimana",
    });
    expect(hit).toMatchObject({
      answer: "Ajukan surat 30 hari sebelumnya (Pasal 28).",
      documentIds: ["doc-1"],
    });
    expect(await lookupLegalAnswer(prisma as never, { ...cacheKey, version: "v2" })).toBeNull();
    expect(
      await lookupLegalAnswer(prisma as never, { ...cacheKey, question: "cara cuti gimana" }),
    ).toBeNull();
  });

  it("does not reuse an expired answer", async () => {
    const { prisma, rows } = fakePrisma();
    await storeLegalAnswer(prisma as never, cacheKey, { text: "Jawaban", documentIds: [] });
    for (const row of rows.values()) row.expiresAt = new Date(Date.now() - 1);
    expect(await lookupLegalAnswer(prisma as never, cacheKey)).toBeNull();
  });

  it("does not match a question digested with another organization's key", async () => {
    const first = fakePrisma(key);
    await storeLegalAnswer(first.prisma as never, cacheKey, { text: "A", documentIds: [] });
    const [storedKey] = [...first.rows.values()].map((row) => row.questionKey);
    const second = fakePrisma(otherKey);
    await storeLegalAnswer(second.prisma as never, cacheKey, { text: "A", documentIds: [] });
    const [otherStoredKey] = [...second.rows.values()].map((row) => row.questionKey);
    expect(storedKey).not.toBe(otherStoredKey);
  });

  it("replays a cached answer by attaching its documents, then posting it", async () => {
    const events: AgentRuntimeEvent[] = [];
    for await (const event of replayLegalAnswer("run-1", {
      id: "c1",
      answer: "Jawaban",
      documentIds: ["doc-1"],
    }))
      events.push(event);
    expect(events).toEqual([
      {
        type: "tool",
        name: "attach_company_document",
        args: { documentId: "doc-1" },
        executionId: "run-1:legal-cache:attach:0",
      },
      { type: "text", text: "Jawaban" },
      { type: "done", text: "Jawaban" },
    ]);
  });

  it("notes the search, attachments and final answer of a live run without changing its events", async () => {
    async function* live(): AsyncIterable<AgentRuntimeEvent> {
      yield {
        type: "tool",
        name: "company_documents_search",
        args: { query: "resign" },
        executionId: "1",
      };
      yield {
        type: "tool",
        name: "attach_company_document",
        args: { documentId: "doc-1" },
        executionId: "2",
      };
      yield { type: "text", text: "Ajukan " };
      yield { type: "text", text: "surat." };
      yield { type: "done", text: "" };
    }
    const observation: LegalRunObservation = { searched: false, documentIds: [], finalText: "" };
    const seen: AgentRuntimeEvent[] = [];
    for await (const event of observeLegalRun(live(), observation)) seen.push(event);
    expect(seen).toHaveLength(5);
    expect(observation).toEqual({
      searched: true,
      documentIds: ["doc-1"],
      finalText: "Ajukan surat.",
    });
  });
});
