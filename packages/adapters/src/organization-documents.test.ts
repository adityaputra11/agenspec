import { randomBytes } from "node:crypto";
import type { ArtifactStore } from "@rakazo/adapter-kit";
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
        where: { id: "doc-1", organizationId: "org-2", status: "ready" },
      }),
    );
  });
});
