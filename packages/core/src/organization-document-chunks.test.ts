import { describe, expect, it } from "vitest";
import {
  chunkOrganizationDocument,
  ORGANIZATION_CHUNK_MAX_CHARS,
} from "./organization-document-chunks.js";

describe("chunkOrganizationDocument", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkOrganizationDocument("")).toEqual([]);
    expect(chunkOrganizationDocument("  \n\n ")).toEqual([]);
  });

  it("splits BAB and Pasal sections and names the nearest heading path", () => {
    const text = [
      "BAB X",
      "Pemutusan Hubungan Kerja",
      "Pasal 31",
      "Pekerja dapat mengundurkan diri dengan pemberitahuan tertulis.",
      "Pasal 32",
      "Pemberi kerja wajib membayar pesangon.",
    ].join("\n");
    const chunks = chunkOrganizationDocument(text);
    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      "BAB X",
      "BAB X › Pasal 31",
      "BAB X › Pasal 32",
    ]);
    expect(chunks[1]!.content).toContain("mengundurkan diri");
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual([0, 1, 2]);
  });

  it("follows Markdown heading levels", () => {
    const chunks = chunkOrganizationDocument(
      "# Handbook\nIntro\n## Leave\nAnnual leave text\n## Pay\nPay text",
    );
    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      "Handbook",
      "Handbook › Leave",
      "Handbook › Pay",
    ]);
  });

  it("keeps text before the first heading with an empty heading", () => {
    const chunks = chunkOrganizationDocument("Preamble text\nPasal 1\nBody");
    expect(chunks[0]).toMatchObject({ heading: "", content: "Preamble text" });
  });

  it("bounds long sections on paragraph boundaries with overlap", () => {
    const paragraph = "a".repeat(600);
    const text = ["Pasal 1", paragraph, paragraph, paragraph, paragraph].join("\n\n");
    const chunks = chunkOrganizationDocument(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(ORGANIZATION_CHUNK_MAX_CHARS);
      expect(chunk.heading).toBe("Pasal 1");
    }
  });

  it("hard-slices a single paragraph longer than the cap", () => {
    const chunks = chunkOrganizationDocument("x".repeat(ORGANIZATION_CHUNK_MAX_CHARS * 2 + 10));
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.content.length <= ORGANIZATION_CHUNK_MAX_CHARS)).toBe(
      true,
    );
  });

  it("drops empty sections", () => {
    const chunks = chunkOrganizationDocument("Pasal 1\n\nPasal 2\nText");
    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Pasal 2"]);
  });
});
