import { randomBytes } from "node:crypto";
import type { ArtifactStore } from "@rakazo/adapter-kit";
import { encryptText } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  COMPANY_EXCERPT_MAX_CHARS,
  processOrganizationDocument,
  rankCompanyCandidates,
  readyCompanyDocument,
  searchCompanyDocuments,
} from "./organization-documents.js";

const key = { id: "key-1", spaceId: "org-1", version: 1, key: randomBytes(32) };

function artifactStore(bytes: Uint8Array): ArtifactStore {
  return {
    describe: () => ({ id: "fake", contractVersion: "1", adapterVersion: "0", capabilities: {} }),
    put: vi.fn(),
    get: vi.fn(async () => bytes),
    remove: vi.fn(async () => undefined),
  } as unknown as ArtifactStore;
}

function fakePrisma(options: { row: Record<string, unknown> | null; encrypted: boolean }) {
  const tx: {
    organizationDocumentChunk: { deleteMany: unknown; createMany: unknown };
    organizationDocument: { update: unknown };
  } = {
    organizationDocumentChunk: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    organizationDocument: { update: vi.fn(async () => ({})) },
  };
  const documentUpdate = vi.fn(async () => ({}));
  const prisma = {
    organizationDocument: {
      findUnique: vi.fn(async () => options.row),
      update: documentUpdate,
    },
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    ...(options.encrypted
      ? {
          $contentEncryption: () => ({
            ring: { current: async () => key },
          }),
        }
      : {}),
  };
  return { prisma, tx, documentUpdate };
}

const row = {
  id: "doc-1",
  organizationId: "org-1",
  spaceId: "org-1",
  name: "Peraturan Perusahaan",
  mimeType: "text/plain",
  status: "processing",
  artifactStorageId: "artifact-1",
  createdByUserId: "user-1",
};

describe("processOrganizationDocument", () => {
  it("stores encrypted sections, then marks the document ready with their count", async () => {
    const text =
      "BAB X\nPemutusan\nPasal 31\nPekerja dapat mengundurkan diri.\nPasal 32\nPesangon.";
    const { prisma, tx, documentUpdate } = fakePrisma({ row, encrypted: true });
    await processOrganizationDocument(
      { prisma: prisma as never, artifacts: artifactStore(new TextEncoder().encode(text)) },
      "doc-1",
    );
    expect(tx.organizationDocumentChunk.createMany).toHaveBeenCalledOnce();
    const createArgs = (
      tx.organizationDocumentChunk.createMany as unknown as {
        mock: {
          calls: Array<
            [{ data: Array<{ content: string; searchTokens: number[]; heading: string }> }]
          >;
        };
      }
    ).mock.calls[0]![0];
    const data = createArgs.data;
    expect(data).toHaveLength(3);
    expect(data[1]!.content).not.toContain("mengundurkan");
    expect(data[1]!.searchTokens.length).toBeGreaterThan(0);
    expect(data[1]!.heading).toBe("BAB X › Pasal 31");
    expect(tx.organizationDocument.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { status: "ready", chunkCount: 3, error: null },
    });
    expect(documentUpdate).not.toHaveBeenCalled();
  });

  it("marks the document failed with a short reason when encryption is not configured", async () => {
    const { prisma, documentUpdate } = fakePrisma({ row, encrypted: false });
    await processOrganizationDocument(
      { prisma: prisma as never, artifacts: artifactStore(new TextEncoder().encode("Pasal 1\nx")) },
      "doc-1",
    );
    expect(documentUpdate).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { status: "failed", error: "Could not read this file." },
    });
  });

  it("marks a file with no text as failed", async () => {
    const { prisma, documentUpdate } = fakePrisma({ row, encrypted: true });
    await processOrganizationDocument(
      { prisma: prisma as never, artifacts: artifactStore(new TextEncoder().encode("   ")) },
      "doc-1",
    );
    expect(documentUpdate).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { status: "failed", error: "No text found in this file" },
    });
  });

  it("does nothing for a document that is not processing", async () => {
    const { prisma, documentUpdate } = fakePrisma({
      row: { ...row, status: "ready" },
      encrypted: true,
    });
    await processOrganizationDocument(
      { prisma: prisma as never, artifacts: artifactStore(new Uint8Array()) },
      "doc-1",
    );
    expect(documentUpdate).not.toHaveBeenCalled();
  });
});

describe("rankCompanyCandidates", () => {
  it("orders chunks by distinct matched tokens, then document order, and drops misses", () => {
    const ranked = rankCompanyCandidates(
      [
        { id: "a", ordinal: 0, searchTokens: [1, 9] },
        { id: "b", ordinal: 1, searchTokens: [1, 2, 3] },
        { id: "c", ordinal: 2, searchTokens: [2, 3, 3, 3] },
        { id: "d", ordinal: 3, searchTokens: [7] },
        { id: "e", ordinal: 4, searchTokens: [1, 2] },
      ],
      [1, 2, 3],
    );
    expect(ranked.map((item) => item.id)).toEqual(["b", "c", "e", "a"]);
    expect(ranked.find((item) => item.id === "c")!.matched).toBe(2);
  });

  it("returns at most the limit", () => {
    const chunks = Array.from({ length: 10 }, (_, ordinal) => ({
      id: `c${ordinal}`,
      ordinal,
      searchTokens: [5],
    }));
    expect(rankCompanyCandidates(chunks, [5], 3)).toHaveLength(3);
  });
});

describe("searchCompanyDocuments", () => {
  it("returns nothing when the database has no encryption configured", async () => {
    await expect(
      searchCompanyDocuments({} as never, { organizationId: "org-1", query: "resign", limit: 5 }),
    ).resolves.toEqual([]);
  });

  it("caps excerpts", () => {
    expect(COMPANY_EXCERPT_MAX_CHARS).toBe(1_200);
  });
});

describe("readyCompanyDocument", () => {
  it("refuses a document that belongs to another organization", async () => {
    const findFirst = vi.fn(async ({ where }: { where: { organizationId: string } }) =>
      where.organizationId === "org-1"
        ? { id: "doc-1", name: "Policy", mimeType: "text/plain", artifactStorageId: "a" }
        : null,
    );
    const prisma = { organizationDocument: { findFirst } };
    await expect(
      readyCompanyDocument(prisma as never, { organizationId: "org-2", documentId: "doc-1" }),
    ).resolves.toBeNull();
    await expect(
      readyCompanyDocument(prisma as never, { organizationId: "org-1", documentId: "doc-1" }),
    ).resolves.toMatchObject({ id: "doc-1" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-1", organizationId: "org-2", status: "ready", botId: null },
      }),
    );
  });
});

/** Whether a row's botId passes a where clause built by companyScope. */
function botScopeMatches(
  botId: string | null,
  where: { botId?: string | null; OR?: Array<{ botId: string | null }> },
): boolean {
  if (where.OR) return where.OR.some((clause) => clause.botId === botId);
  if ("botId" in where) return botId === where.botId;
  return true;
}

/** Three documents: the organization's own, and two bots' reference documents. */
const companyDocuments = [
  { id: "doc-org", botId: null, referenceName: null, name: "Policy", status: "ready" },
  { id: "doc-a", botId: "bot-a", referenceName: "Proposal", name: "proposal.pdf", status: "ready" },
  { id: "doc-b", botId: "bot-b", referenceName: "Proposal", name: "secret.pdf", status: "ready" },
];

function searchPrisma() {
  const searchKey = { id: "key-1", spaceId: "org-1", version: 1, key: randomBytes(32) };
  const text = (id: string) => `Clause from ${id}`;
  const chunks = companyDocuments.map((document) => ({
    id: `chunk-${document.id}`,
    documentId: document.id,
    botId: document.botId,
    organizationId: "org-1",
    ordinal: 0,
    heading: document.name,
    searchTokens: [42],
    content: encryptText(
      searchKey,
      {
        table: "organization_document_chunks",
        column: "content",
        rowId: `chunk-${document.id}`,
        owner: document.id,
      },
      text(document.id),
    ),
  }));
  const prisma = {
    $contentEncryption: () => ({
      messageSearchTokens: async () => [[42]],
      ring: { byId: async () => searchKey },
    }),
    organizationDocumentChunk: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) =>
        chunks.filter(
          (chunk) =>
            (where.organizationId === undefined || where.organizationId === chunk.organizationId) &&
            (where.id?.in === undefined || where.id.in.includes(chunk.id)) &&
            (where.searchTokens === undefined || chunk.searchTokens.includes(42)) &&
            botScopeMatches(chunk.botId, where),
        ),
      ),
    },
    organizationDocument: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) =>
        companyDocuments.filter(
          (document) =>
            (where.id?.in === undefined || where.id.in.includes(document.id)) &&
            where.organizationId === "org-1" &&
            where.status === "ready" &&
            botScopeMatches(document.botId, where),
        ),
      ),
    },
  };
  return prisma;
}

describe("company search scope", () => {
  const query = { organizationId: "org-1", query: "clause", limit: 10 };

  it("returns the organization's documents and the asking bot's own reference, never another bot's", async () => {
    const results = await searchCompanyDocuments(searchPrisma() as never, {
      ...query,
      botId: "bot-a",
    });
    expect(results.map((result) => result.documentId).sort()).toEqual(["doc-a", "doc-org"]);
    expect(results.find((result) => result.documentId === "doc-a")).toMatchObject({
      documentName: "proposal.pdf",
      referenceName: "Proposal",
    });
    expect(results.find((result) => result.documentId === "doc-org")).not.toHaveProperty(
      "referenceName",
    );
  });

  it("returns only the organization's documents when no bot is given", async () => {
    const results = await searchCompanyDocuments(searchPrisma() as never, query);
    expect(results.map((result) => result.documentId)).toEqual(["doc-org"]);
  });

  it("gives a bot with no reference documents only the organization's documents", async () => {
    const results = await searchCompanyDocuments(searchPrisma() as never, {
      ...query,
      botId: "bot-c",
    });
    expect(results.map((result) => result.documentId)).toEqual(["doc-org"]);
  });

  it("scopes readyCompanyDocument to the organization's documents and the asking bot's own", async () => {
    const findFirst = vi.fn(async () => null);
    const prisma = { organizationDocument: { findFirst } };
    await readyCompanyDocument(prisma as never, {
      organizationId: "org-1",
      documentId: "doc-b",
      botId: "bot-a",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "doc-b",
          organizationId: "org-1",
          status: "ready",
          OR: [{ botId: null }, { botId: "bot-a" }],
        },
      }),
    );
  });
});
