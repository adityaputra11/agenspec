import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import {
  memberMayUseProvider,
  organizationModelFor,
  organizationModelRecord,
} from "./organization-model.js";

/** Two organizations, each with its own Space; only organization A has a model connected. */
function prismaWith(settings: Record<string, object>) {
  const spaces: Record<string, { organizationId: string }> = {
    "space-a": { organizationId: "org-a" },
    "space-a2": { organizationId: "org-a" },
    "space-b": { organizationId: "org-b" },
  };
  return {
    space: {
      findUnique: async ({ where }: { where: { id: string } }) => spaces[where.id] ?? null,
    },
    organizationModelSettings: {
      findUnique: async ({ where }: { where: { organizationId: string } }) =>
        settings[where.organizationId] ?? null,
    },
  } as unknown as Pick<PrismaClient, "space" | "organizationModelSettings">;
}

const connected = {
  provider: "openai",
  modelId: "gpt-test",
  credentialCipher: "ciphertext-a",
  restrictMemberProviders: true,
  allowedProviders: ["anthropic"],
  baseUrl: null,
  spaceId: "org-a",
  updatedByUserId: "admin-a",
  updatedAt: new Date(0),
};

describe("organization model lookup", () => {
  it("gives every Space of the organization its model", async () => {
    const prisma = prismaWith({ "org-a": connected });
    const model = await organizationModelFor(prisma, { spaceId: "space-a2" });
    expect(model).toMatchObject({
      organizationId: "org-a",
      provider: "openai",
      modelId: "gpt-test",
      credentialCipher: "ciphertext-a",
      restrictMemberProviders: true,
      allowedProviders: ["anthropic"],
    });
  });

  it("never hands one organization's model to a Space of another", async () => {
    const prisma = prismaWith({ "org-a": connected });
    expect(await organizationModelFor(prisma, { spaceId: "space-b" })).toBeNull();
    expect(await organizationModelFor(prisma, { spaceId: "missing-space" })).toBeNull();
  });

  it("is null when the organization has a policy but no connected model", async () => {
    const prisma = prismaWith({
      "org-a": { ...connected, provider: null, credentialCipher: null },
    });
    expect(await organizationModelFor(prisma, { spaceId: "space-a" })).toBeNull();
  });

  it("binds the ciphertext to its own organization's record", () => {
    expect(organizationModelRecord("org-a")).not.toBe(organizationModelRecord("org-b"));
  });
});

describe("member provider policy", () => {
  it("lets every provider through when the organization does not restrict them", () => {
    expect(
      memberMayUseProvider({ restrictMemberProviders: false, allowedProviders: [] }, "x"),
    ).toBe(true);
    expect(memberMayUseProvider(null, "x")).toBe(true);
  });

  it("allows only listed providers when restricted, and an empty list allows none", () => {
    const restricted = { restrictMemberProviders: true, allowedProviders: ["anthropic"] };
    expect(memberMayUseProvider(restricted, "anthropic")).toBe(true);
    expect(memberMayUseProvider(restricted, "openai")).toBe(false);
    expect(
      memberMayUseProvider({ restrictMemberProviders: true, allowedProviders: [] }, "anthropic"),
    ).toBe(false);
  });
});
