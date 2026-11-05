import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

/** True when a comma-separated Member role includes owner or admin. */
export function orgAdminRoles(role: string): boolean {
  return role
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === "owner" || part === "admin");
}

export interface OrgMembership {
  organizationId: string;
  organizationName: string;
  role: string;
}

/** The actor's organization and their role in it, found through the actor's current Space. */
export async function orgMembershipOf(
  prisma: Pick<PrismaClient, "space" | "member">,
  actor: Pick<Actor, "spaceId" | "userId">,
): Promise<OrgMembership | null> {
  const space = await prisma.space.findUnique({
    where: { id: actor.spaceId },
    select: { organizationId: true, organization: { select: { name: true } } },
  });
  if (!space) return null;
  const member = await prisma.member.findUnique({
    where: {
      organizationId_userId: { organizationId: space.organizationId, userId: actor.userId },
    },
    select: { role: true },
  });
  if (!member) return null;
  return {
    organizationId: space.organizationId,
    organizationName: space.organization.name,
    role: member.role,
  };
}

/** Returns the actor's organization id, or forbids when they are not an owner or admin. */
export async function requireOrgAdmin(
  prisma: Pick<PrismaClient, "space" | "member">,
  actor: Pick<Actor, "spaceId" | "userId">,
): Promise<string> {
  const membership = await orgMembershipOf(prisma, actor);
  if (!membership || !orgAdminRoles(membership.role)) throw new ORPCError("FORBIDDEN");
  return membership.organizationId;
}

export interface OrgAppPolicy {
  restrictApps: boolean;
  allowedApps: string[];
}

/** The app policy of the actor's organization, or null when it has none saved. */
export async function orgAppPolicyFor(
  prisma: Pick<PrismaClient, "space" | "organizationPolicy">,
  actor: Pick<Actor, "spaceId">,
): Promise<OrgAppPolicy | null> {
  const space = await prisma.space.findUnique({
    where: { id: actor.spaceId },
    select: { organizationId: true },
  });
  if (!space) return null;
  return prisma.organizationPolicy.findUnique({
    where: { organizationId: space.organizationId },
    select: { restrictApps: true, allowedApps: true },
  });
}

/** Whether an organization policy lets members use an app; without restrictions every app is allowed. */
export function isAppAllowed(policy: OrgAppPolicy | null, slug: string): boolean {
  if (!policy?.restrictApps) return true;
  const wanted = slug.trim().toLowerCase();
  return policy.allowedApps.some((allowed) => allowed.toLowerCase() === wanted);
}
