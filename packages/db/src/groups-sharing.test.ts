import { colorForUserId } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { createGroupRepos, GroupPeopleError } from "./groups.js";
import { IsolationError } from "./scope.js";

const owner = {
  spaceId: "space-1",
  userId: "owner-1",
  email: "owner@example.test",
  isDeploymentOwner: false,
};
const shared = { ...owner, userId: "shared-1", email: "shared@example.test" };
const stranger = { ...owner, userId: "stranger-1", email: "stranger@example.test" };

const loadedGroup = {
  id: "group-1",
  spaceId: "space-1",
  userId: "owner-1",
  name: "Crew",
  instructions: "",
  pinned: false,
  sectionId: null,
  archivedAt: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-02T00:00:00.000Z"),
  thread: { id: "thread-1", unread: false },
  members: [
    { bot: { id: "bot-a", name: "Alpha", color: "#111", avatarSet: "organic", runs: [] } },
    { bot: { id: "bot-b", name: "Beta", color: "#222", avatarSet: "organic", runs: [] } },
  ],
  users: [{ userId: "shared-1", user: { name: "Sam", email: "shared@example.test" } }],
};

/** One fake client serves as both the root and the transaction, like the real Prisma client. */
function fakePrisma(
  options: {
    lockRows?: Array<{ id: string }>;
    chatGroup?: Record<string, unknown>;
    member?: Record<string, unknown>;
  } = {},
) {
  const client = {
    $queryRaw: vi.fn(async () => options.lockRows ?? [{ id: "group-1" }]),
    chatGroup: {
      findFirst: vi.fn(async () => null),
      findFirstOrThrow: vi.fn(async () => loadedGroup),
      update: vi.fn(async () => ({})),
      ...options.chatGroup,
    },
    member: { findMany: vi.fn(async () => []), ...options.member },
    chatGroupUser: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    message: { findMany: vi.fn(async () => []) },
  };
  const prisma = {
    ...client,
    $transaction: vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client)),
  };
  return { client, prisma: prisma as unknown as PrismaClient };
}

describe("group access for a shared person", () => {
  it("resolves a group shared with the actor as a send target", async () => {
    const { client, prisma } = fakePrisma();
    client.chatGroup.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(loadedGroup as never);

    const group = await createGroupRepos(prisma).getGroupTarget(shared, "group-1");

    expect(group.id).toBe("group-1");
    const lookups = client.chatGroup.findFirst.mock.calls as unknown as Array<[{ where: unknown }]>;
    expect(lookups[1]![0]).toMatchObject({
      where: {
        id: "group-1",
        spaceId: "space-1",
        archivedAt: null,
        users: { some: { userId: "shared-1" } },
      },
    });
  });

  it("refuses to update, archive or remove a group it is only shared into", async () => {
    const { prisma } = fakePrisma({ lockRows: [] });
    const groupRepos = createGroupRepos(prisma);

    await expect(
      groupRepos.updateGroup(shared, { groupId: "group-1", name: "Renamed" }),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(groupRepos.archiveGroup(shared, "group-1")).rejects.toBeInstanceOf(IsolationError);
    await expect(groupRepos.removeGroup(shared, "group-1")).rejects.toBeInstanceOf(IsolationError);
    await expect(
      groupRepos.setGroupPeople(shared, { groupId: "group-1", userIds: [] }),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("gives a person outside the group no target", async () => {
    const { prisma } = fakePrisma();

    await expect(
      createGroupRepos(prisma).getGroupTarget(stranger, "group-1"),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(createGroupRepos(prisma).getGroup(stranger, "group-1")).rejects.toBeInstanceOf(
      IsolationError,
    );
  });

  it("maps the owner and the shared people onto the group", async () => {
    const { prisma } = fakePrisma({
      chatGroup: { findFirst: vi.fn(async () => loadedGroup) },
    });

    const group = await createGroupRepos(prisma).getGroup(owner, "group-1");
    const mapped = createGroupRepos(prisma).mapGroup(group);

    expect(mapped.ownerUserId).toBe("owner-1");
    expect(mapped.people).toEqual([
      {
        userId: "shared-1",
        name: "Sam",
        email: "shared@example.test",
        color: colorForUserId("shared-1"),
      },
    ]);
  });
});

describe("setGroupPeople", () => {
  it("replaces the shared people with the owner as the adder", async () => {
    const { client, prisma } = fakePrisma({
      chatGroup: { findFirst: vi.fn(async () => ({ space: { organizationId: "org-1" } })) },
      member: { findMany: vi.fn(async () => [{ userId: "shared-1" }]) },
    });

    const group = await createGroupRepos(prisma).setGroupPeople(owner, {
      groupId: "group-1",
      userIds: ["shared-1", "shared-1"],
    });

    expect(client.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", userId: { in: ["shared-1"] } },
      }),
    );
    expect(client.chatGroupUser.deleteMany).toHaveBeenCalledWith({
      where: { groupId: "group-1" },
    });
    expect(client.chatGroupUser.createMany).toHaveBeenCalledWith({
      data: [{ groupId: "group-1", userId: "shared-1", addedByUserId: "owner-1" }],
    });
    expect(group.people).toEqual([
      {
        userId: "shared-1",
        name: "Sam",
        email: "shared@example.test",
        color: colorForUserId("shared-1"),
      },
    ]);
  });

  it("rejects a person outside the group's organization", async () => {
    const { client, prisma } = fakePrisma({
      chatGroup: { findFirst: vi.fn(async () => ({ space: { organizationId: "org-1" } })) },
      member: { findMany: vi.fn(async () => []) },
    });

    await expect(
      createGroupRepos(prisma).setGroupPeople(owner, {
        groupId: "group-1",
        userIds: ["outsider-1"],
      }),
    ).rejects.toBeInstanceOf(GroupPeopleError);
    expect(client.chatGroupUser.deleteMany).not.toHaveBeenCalled();
    expect(client.chatGroupUser.createMany).not.toHaveBeenCalled();
  });

  it("rejects the owner as one of the people", async () => {
    const { client, prisma } = fakePrisma({
      chatGroup: { findFirst: vi.fn(async () => ({ space: { organizationId: "org-1" } })) },
    });

    await expect(
      createGroupRepos(prisma).setGroupPeople(owner, {
        groupId: "group-1",
        userIds: ["owner-1"],
      }),
    ).rejects.toBeInstanceOf(GroupPeopleError);
    expect(client.member.findMany).not.toHaveBeenCalled();
    expect(client.chatGroupUser.deleteMany).not.toHaveBeenCalled();
  });
});

describe("listGroupPeopleCandidates", () => {
  it("lists the organization's members except the owner", async () => {
    const findMany = vi.fn(async () => [
      { userId: "shared-1", user: { name: "Sam", email: "shared@example.test" } },
    ]);
    const { prisma } = fakePrisma({
      chatGroup: { findFirst: vi.fn(async () => ({ space: { organizationId: "org-1" } })) },
      member: { findMany },
    });

    const candidates = await createGroupRepos(prisma).listGroupPeopleCandidates(owner, "group-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", userId: { not: "owner-1" } },
      }),
    );
    expect(candidates).toEqual([
      {
        userId: "shared-1",
        name: "Sam",
        email: "shared@example.test",
        color: colorForUserId("shared-1"),
      },
    ]);
  });

  it("is owner only", async () => {
    const { prisma } = fakePrisma();

    await expect(
      createGroupRepos(prisma).listGroupPeopleCandidates(shared, "group-1"),
    ).rejects.toBeInstanceOf(IsolationError);
  });
});

describe("leaveGroup", () => {
  it("removes only the actor's own row", async () => {
    const { client, prisma } = fakePrisma({
      chatGroup: { findFirst: vi.fn(async () => ({ userId: "owner-1" })) },
    });

    await createGroupRepos(prisma).leaveGroup(shared, "group-1");

    expect(client.chatGroupUser.deleteMany).toHaveBeenCalledWith({
      where: { groupId: "group-1", userId: "shared-1" },
    });
  });

  it("refuses the owner", async () => {
    const { client, prisma } = fakePrisma({
      chatGroup: { findFirst: vi.fn(async () => ({ userId: "owner-1" })) },
    });

    await expect(createGroupRepos(prisma).leaveGroup(owner, "group-1")).rejects.toBeInstanceOf(
      GroupPeopleError,
    );
    expect(client.chatGroupUser.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a person the group is not shared with", async () => {
    const { client, prisma } = fakePrisma();

    await expect(createGroupRepos(prisma).leaveGroup(stranger, "group-1")).rejects.toBeInstanceOf(
      IsolationError,
    );
    expect(client.chatGroupUser.deleteMany).not.toHaveBeenCalled();
  });
});
