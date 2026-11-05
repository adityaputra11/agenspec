import type { Actor } from "@rakazo/contracts";
import { canonicalPiProviderId } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";

/** Which providers members may run on their own connections, when the organization restricts them. */
export type OrganizationProviderPolicy = {
  restrictMemberProviders: boolean;
  allowedProviders: readonly string[];
};

/** The organization's model, as runs select it; the connection stays encrypted until a run needs it. */
export type OrganizationModel = OrganizationProviderPolicy & {
  organizationId: string;
  provider: string;
  modelId: string;
  credentialCipher: string;
};

/** The record id a connection's ciphertext is bound to, so it cannot be replayed under another organization. */
export function organizationModelRecord(organizationId: string): string {
  return `organization-model:${organizationId}`;
}

/** Whether a member's own connection to this provider may run, given the organization's restriction. */
export function memberMayUseProvider(
  policy: OrganizationProviderPolicy | null | undefined,
  provider: string,
): boolean {
  if (!policy?.restrictMemberProviders) return true;
  const wanted = canonicalPiProviderId(provider);
  return policy.allowedProviders.some((allowed) => canonicalPiProviderId(allowed) === wanted);
}

/**
 * The organization settings row for the actor's current Space, or null when the Space has no
 * organization or the organization never saved any. Reads as the system: the row's tenant key
 * is the organization, not the Space a run is in.
 */
export async function organizationModelSettingsFor(
  prisma: Pick<PrismaClient, "space" | "organizationModelSettings">,
  actor: Pick<Actor, "spaceId">,
) {
  return runAsSystem("read the organization model settings", async () => {
    const space = await prisma.space.findUnique({
      where: { id: actor.spaceId },
      select: { organizationId: true },
    });
    if (!space) return null;
    const row = await prisma.organizationModelSettings.findUnique({
      where: { organizationId: space.organizationId },
    });
    return row ? { ...row, organizationId: space.organizationId } : null;
  });
}

/** The organization's model for a Space, or null when none is connected. */
export async function organizationModelFor(
  prisma: Pick<PrismaClient, "space" | "organizationModelSettings">,
  actor: Pick<Actor, "spaceId">,
): Promise<OrganizationModel | null> {
  const row = await organizationModelSettingsFor(prisma, actor);
  if (!row?.provider || !row.modelId || !row.credentialCipher) return null;
  return {
    organizationId: row.organizationId,
    provider: row.provider,
    modelId: row.modelId,
    credentialCipher: row.credentialCipher,
    restrictMemberProviders: row.restrictMemberProviders,
    allowedProviders: row.allowedProviders,
  };
}
