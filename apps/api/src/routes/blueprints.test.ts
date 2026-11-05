import type { ORPCError } from "@orpc/server";
import { createRouterClient } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";

const actor = {
  spaceId: "org-a",
  userId: "user-a",
  email: "a@rakazo.test",
  isDeploymentOwner: false,
} satisfies Actor;

type Row = Record<string, unknown>;

/** Matches the subset of Prisma `where` clauses these routes use: equality, `not` and `in`. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const value = row[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const clause = expected as { not?: unknown; in?: unknown[] };
      if ("not" in clause) return value !== clause.not;
      if ("in" in clause) return (clause.in ?? []).includes(value);
    }
    return value === expected;
  });
}

const bot = (id: string, userId: string, blueprintId: string | null) => ({
  id,
  spaceId: "org-a",
  userId,
  blueprintId,
});

function fixture({ role }: { role: string | null }) {
  const bots: Row[] = [
    bot("bot-a", "user-a", "bp-1"),
    bot("bot-b", "user-b", "bp-1"),
    bot("bot-c", "user-a", null),
  ];
  const blueprints: Row[] = [
    {
      id: "bp-1",
      organizationId: "org-a",
      spaceId: "org-a",
      name: "Spec",
      description: "Writes specs",
      instructions: "Write specs.",
      referenceNames: ["Proposal", "Design Approval"],
      createdAt: new Date(1),
      updatedAt: new Date(2),
    },
  ];
  const documents: Row[] = [
    {
      id: "org-doc",
      organizationId: "org-a",
      botId: null,
      referenceName: null,
      name: "Handbook",
      mimeType: "text/plain",
      sizeBytes: 5,
      status: "ready",
      error: null,
      chunkCount: 1,
      artifactStorageId: "stored-org",
      createdAt: new Date(1),
    },
    {
      id: "doc-old",
      organizationId: "org-a",
      botId: "bot-a",
      referenceName: "Proposal",
      name: "Old proposal",
      mimeType: "text/plain",
      sizeBytes: 3,
      status: "ready",
      error: null,
      chunkCount: 1,
      artifactStorageId: "stored-old",
      createdAt: new Date(2),
    },
  ];
  let created = 0;
  const findMany = (rows: Row[]) =>
    vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((row) => matches(row, where)),
    );
  const prisma = {
    space: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "org-a" ? { organizationId: "org-a", organization: { name: "Org A" } } : null,
      ),
    },
    member: {
      findUnique: vi.fn(async () => (role ? { role } : null)),
    },
    bot: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          bots.find((row) => matches(row, where)) ?? null,
      ),
    },
    agentBlueprint: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          blueprints.find((row) => matches(row, where)) ?? null,
      ),
      findMany: findMany(blueprints),
    },
    organizationDocument: {
      findMany: findMany(documents),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          documents.find((row) => matches(row, where)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        created += 1;
        const row = {
          id: `doc-new-${created}`,
          chunkCount: 0,
          error: null,
          createdAt: new Date(3),
          ...data,
        };
        documents.push(row);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        for (let index = documents.length - 1; index >= 0; index -= 1) {
          if (matches(documents[index] as Row, where)) documents.splice(index, 1);
        }
        return { count: 0 };
      }),
    },
    organizationDocumentChunk: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };
  const artifacts = {
    put: vi.fn(async () => ({ id: "stored-new" })),
    remove: vi.fn(async () => undefined),
  };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const deps = {
    prisma,
    secrets: {},
    artifacts,
    jobs,
    env: { sandboxProvider: "fake", mcpAllowPrivateEndpoint: false },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), { context: { actor } as never });
  return { client, prisma, artifacts, documents };
}

const base64 = (text: string) => Buffer.from(text).toString("base64");

async function rejectionOf(promise: Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    return error as ORPCError<string, unknown>;
  }
  throw new Error("expected the call to fail");
}

describe("organization blueprint admin routes", () => {
  it("refuses members who are not owners or admins", async () => {
    const { client } = fixture({ role: "member" });
    const error = await rejectionOf(client.cms.blueprints.list());
    expect(error.code).toBe("FORBIDDEN");
    await expect(
      client.cms.blueprints.create({
        name: "Spec",
        description: "",
        instructions: "Write specs.",
        referenceNames: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists an admin's blueprints with their reference names", async () => {
    const { client } = fixture({ role: "owner" });
    const rows = await client.cms.blueprints.list();
    expect(rows).toEqual([
      expect.objectContaining({
        id: "bp-1",
        referenceNames: ["Proposal", "Design Approval"],
        updatedAt: new Date(2).toISOString(),
      }),
    ]);
  });

  it("does not let an admin update a blueprint from another organization", async () => {
    const { client } = fixture({ role: "admin" });
    await expect(
      client.cms.blueprints.update({
        id: "bp-other",
        name: "Spec",
        description: "",
        instructions: "Write specs.",
        referenceNames: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("organization documents", () => {
  it("lists only the organization's own documents, not bot references", async () => {
    const { client, prisma } = fixture({ role: "owner" });
    const rows = await client.cms.documents.list();
    expect(prisma.organizationDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ botId: null }) }),
    );
    expect(rows.map((row) => row.id)).toEqual(["org-doc"]);
  });

  it("deletes only organization documents through the admin route", async () => {
    const { client } = fixture({ role: "owner" });
    await expect(client.cms.documents.delete({ id: "doc-old" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("bot blueprints for members", () => {
  it("lists blueprints of the actor's organization without instructions", async () => {
    const { client } = fixture({ role: "member" });
    const rows = await client.blueprints.list();
    expect(rows).toEqual([
      {
        id: "bp-1",
        name: "Spec",
        description: "Writes specs",
        referenceNames: ["Proposal", "Design Approval"],
      },
    ]);
  });

  it("refuses to make a bot from a blueprint of another organization", async () => {
    const { client } = fixture({ role: "member" });
    await expect(
      client.blueprints.createBot({ blueprintId: "bp-other", name: "Spec bot" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to list references of another user's bot", async () => {
    const { client } = fixture({ role: "member" });
    await expect(client.blueprints.references.list({ botId: "bot-b" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses to upload a reference to another user's bot", async () => {
    const { client, artifacts } = fixture({ role: "member" });
    await expect(
      client.blueprints.references.upload({
        botId: "bot-b",
        referenceName: "Proposal",
        name: "Proposal",
        mimeType: "text/plain",
        contentBase64: base64("Scope"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(artifacts.put).not.toHaveBeenCalled();
  });

  it("refuses references for a bot that was not made from a blueprint", async () => {
    const { client } = fixture({ role: "member" });
    await expect(client.blueprints.references.list({ botId: "bot-c" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses an upload whose reference name the blueprint does not declare", async () => {
    const { client, artifacts } = fixture({ role: "member" });
    await expect(
      client.blueprints.references.upload({
        botId: "bot-a",
        referenceName: "Budget",
        name: "Budget",
        mimeType: "text/plain",
        contentBase64: base64("Totals"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(artifacts.put).not.toHaveBeenCalled();
  });

  it("stores an upload under the blueprint's spelling and replaces the slot's old document", async () => {
    const { client, artifacts, documents } = fixture({ role: "member" });
    const saved = await client.blueprints.references.upload({
      botId: "bot-a",
      referenceName: "proposal",
      name: "Q3 proposal",
      mimeType: "text/plain",
      contentBase64: base64("Scope"),
    });
    expect(saved).toMatchObject({ referenceName: "Proposal", status: "processing" });
    expect(documents.find((row) => row.id === "doc-old")).toBeUndefined();
    expect(artifacts.remove).toHaveBeenCalledWith("stored-old", expect.anything());
    const references = await client.blueprints.references.list({ botId: "bot-a" });
    expect(references.map((row) => row.referenceName)).toEqual(["Proposal"]);
  });

  it("removes one of the bot's own reference documents", async () => {
    const { client, artifacts } = fixture({ role: "member" });
    await expect(
      client.blueprints.references.remove({ botId: "bot-a", id: "doc-old" }),
    ).resolves.toEqual({ ok: true });
    expect(artifacts.remove).toHaveBeenCalledWith("stored-old", expect.anything());
  });
});
