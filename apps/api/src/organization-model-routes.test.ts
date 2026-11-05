import { createRouterClient, ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor = {
  spaceId: "space-a",
  userId: "user-a",
  email: "a@rakazo.test",
  isDeploymentOwner: false,
} satisfies Actor;

type Settings = {
  organizationId: string;
  spaceId: string | null;
  provider: string | null;
  modelId: string | null;
  baseUrl: string | null;
  credentialCipher: string | null;
  restrictMemberProviders: boolean;
  allowedProviders: string[];
  updatedByUserId: string | null;
  updatedAt: Date;
};

/** A deployment with one organization, its Space, and the caller's role in it. */
function fixture({ role, settings = null }: { role: string | null; settings?: Settings | null }) {
  const prisma = {
    space: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "space-a"
          ? { organizationId: "org-a", organization: { name: "Org A" } }
          : null,
      ),
    },
    member: {
      findUnique: vi.fn(async () => (role ? { role } : null)),
    },
    organizationModelSettings: {
      findUnique: vi.fn(async () => settings),
      upsert: vi.fn(async ({ create }: { create: Partial<Settings> }) => ({
        ...settings,
        ...create,
        updatedAt: new Date(0),
      })),
    },
  };
  const deps = {
    prisma,
    secrets: {},
    env: { sandboxProvider: "fake", mcpAllowPrivateEndpoint: false },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), { context: { actor } as never });
  return { client, prisma };
}

function policy(restrictMemberProviders: boolean, allowedProviders: string[]): Settings {
  return {
    organizationId: "org-a",
    spaceId: "org-a",
    provider: "openai",
    modelId: "gpt-test",
    baseUrl: null,
    credentialCipher: "ciphertext-secret-must-not-leak",
    restrictMemberProviders,
    allowedProviders,
    updatedByUserId: "admin-a",
    updatedAt: new Date(0),
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to fail");
}

describe("organization model admin routes", () => {
  it("refuses members who are not owners or admins", async () => {
    const { client } = fixture({ role: "member" });
    const error = await rejectionOf(client.cms.models.get());
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("FORBIDDEN");
  });

  it("refuses a caller with no membership in the organization", async () => {
    const { client } = fixture({ role: null });
    await expect(client.cms.models.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      client.cms.models.setPolicy({ restrictMemberProviders: true, allowedProviders: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("shows an admin the model and policy, never the key or the stored connection", async () => {
    const { client } = fixture({ role: "owner", settings: policy(true, ["anthropic"]) });
    const view = await client.cms.models.get();
    expect(view).toMatchObject({
      connected: true,
      provider: "openai",
      modelId: "gpt-test",
      restrictMemberProviders: true,
      allowedProviders: ["anthropic"],
    });
    expect(JSON.stringify(view)).not.toContain("ciphertext-secret-must-not-leak");
    expect(view).not.toHaveProperty("credentialCipher");
  });

  it("saves the member provider policy for an admin", async () => {
    const { client, prisma } = fixture({ role: "admin" });
    const saved = await client.cms.models.setPolicy({
      restrictMemberProviders: true,
      allowedProviders: ["anthropic", "anthropic"],
    });
    expect(prisma.organizationModelSettings.upsert).toHaveBeenCalled();
    // Repeated providers are saved once.
    expect(saved).toMatchObject({ restrictMemberProviders: true, allowedProviders: ["anthropic"] });
  });
});

describe("organization model connection input", () => {
  it("refuses an empty model id", async () => {
    const { client } = fixture({ role: "owner" });
    await expect(
      client.cms.models.connect({ provider: "anthropic", apiKey: "sk-test-key-1234", modelId: "" }),
    ).rejects.toThrow();
  });

  it("refuses an output limit that leaves no room for input", async () => {
    const { client } = fixture({ role: "owner" });
    await expect(
      client.cms.models.connect({
        provider: OPENAI_COMPATIBLE_PROVIDER_ID,
        baseUrl: "https://example.com/v1",
        modelId: "m",
        maxTokens: 1000,
        contextWindow: 1000,
      }),
    ).rejects.toThrow();
  });
});

describe("member provider allowlist on connect", () => {
  it("refuses a new connection to a provider the organization does not list", async () => {
    const { client } = fixture({ role: "member", settings: policy(true, ["anthropic"]) });
    const error = await rejectionOf(
      client.models.connect({ provider: "openai", apiKey: "sk-test-key-1234" }),
    );
    expect((error as ORPCError<string, unknown>).code).toBe("FORBIDDEN");
    expect((error as Error).message).toBe("Your organization does not allow this provider");
  });

  it("refuses every provider while the list is empty", async () => {
    const { client } = fixture({ role: "member", settings: policy(true, []) });
    await expect(
      client.models.connect({ provider: "anthropic", apiKey: "sk-test-key-1234" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a listed provider past the allowlist", async () => {
    const { client } = fixture({ role: "member", settings: policy(true, ["anthropic"]) });
    const error = await rejectionOf(
      client.models.connect({ provider: "anthropic", apiKey: "sk-test-key-1234" }),
    );
    expect((error as ORPCError<string, unknown>).code).not.toBe("FORBIDDEN");
  });

  it("changes nothing for members while the switch is off", async () => {
    const { client } = fixture({ role: "member", settings: policy(false, []) });
    const error = await rejectionOf(
      client.models.connect({ provider: "openai", apiKey: "sk-test-key-1234" }),
    );
    expect((error as ORPCError<string, unknown>).code).not.toBe("FORBIDDEN");
  });
});
