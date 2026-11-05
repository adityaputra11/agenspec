import { describe, expect, it, vi } from "vitest";

const sink = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  bots: undefined as Array<Record<string, unknown>> | undefined,
}));
vi.mock("./repos.js", () => ({
  createRepos: () => ({
    createBot: async (
      actor: { userId: string; spaceId: string },
      input: {
        spawnKey: string;
        seed?: (tx: unknown, botId: string) => Promise<void>;
      },
    ) => {
      const bot: Record<string, unknown> = {
        id: `bot-${sink.created.length + 1}`,
        userId: actor.userId,
        spaceId: actor.spaceId,
        spawnKey: input.spawnKey,
        locked: false,
        instructions: "",
      };
      sink.created.push(bot);
      sink.bots?.push(bot);
      await input.seed?.(
        {
          bot: {
            update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(bot, data),
          },
        },
        bot.id as string,
      );
      return bot;
    },
  }),
}));

import {
  assertBotIdUnlocked,
  assertBotUnlocked,
  ensureLegalBot,
  ensureLegalBotForActor,
  isLayoutOnlyBotChange,
  LEGACY_LEGAL_BOT_SPAWN_KEY,
  LEGAL_BOT,
  LockedBotError,
  legalBotSpawnKey,
} from "./locked-bots.js";

type Row = Record<string, unknown>;

/** An in-memory stand-in for the bot and space tables, enough for ensureLegalBot. */
function fakeDb(
  spaces: Record<string, { isDefault: boolean; deletingAt?: Date | null }>,
  bots: Row[],
) {
  sink.created = [];
  sink.bots = bots;
  const findBot = (where: {
    id?: string;
    spaceId_spawnKey?: { spaceId: string; spawnKey: string };
  }) =>
    bots.find((bot) =>
      where.id
        ? bot.id === where.id
        : bot.spaceId === where.spaceId_spawnKey!.spaceId &&
          bot.spawnKey === where.spaceId_spawnKey!.spawnKey,
    );
  return {
    space: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => spaces[where.id] ?? null),
    },
    bot: {
      findUnique: vi.fn(async ({ where }: { where: never }) => findBot(where) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const bot = bots.find((item) => item.id === where.id)!;
        Object.assign(bot, data);
        return bot;
      }),
    },
  };
}

const DEFAULT = { default: { isDefault: true } };

describe("assertBotUnlocked", () => {
  it("refuses a locked bot with the organization message", () => {
    expect(() => assertBotUnlocked({ locked: true })).toThrow(LockedBotError);
    expect(() => assertBotUnlocked({ locked: true })).toThrow(
      "This bot is managed by your organization",
    );
  });

  it("allows an unlocked bot", () => {
    expect(() => assertBotUnlocked({ locked: false })).not.toThrow();
  });
});

describe("assertBotIdUnlocked", () => {
  it("reads only the lock flag and treats a missing bot as not locked", async () => {
    const findUnique = vi.fn().mockResolvedValue({ locked: true });
    await expect(assertBotIdUnlocked({ bot: { findUnique } } as never, "bot-1")).rejects.toThrow(
      LockedBotError,
    );
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "bot-1" }, select: { locked: true } });

    const missing = { bot: { findUnique: vi.fn().mockResolvedValue(null) } };
    await expect(assertBotIdUnlocked(missing as never, "gone")).resolves.toBeUndefined();
  });
});

describe("isLayoutOnlyBotChange", () => {
  it("accepts only pin, position and section changes", () => {
    expect(isLayoutOnlyBotChange({ pinned: true, sectionId: null, position: 2 })).toBe(true);
    expect(isLayoutOnlyBotChange({ pinned: undefined, name: undefined })).toBe(true);
    expect(isLayoutOnlyBotChange({ pinned: true, name: "Renamed" })).toBe(false);
    expect(isLayoutOnlyBotChange({ instructions: "" })).toBe(false);
  });
});

describe("Legal bot constants", () => {
  it("keys each member's bot by user and names the bot Legal", () => {
    expect(legalBotSpawnKey("user-1")).toBe("builtin:legal:user-1");
    expect(legalBotSpawnKey("user-1")).not.toBe(legalBotSpawnKey("user-2"));
    expect(LEGACY_LEGAL_BOT_SPAWN_KEY).toBe("builtin:legal");
    expect(LEGAL_BOT.name).toBe("Legal");
    expect(LEGAL_BOT.instructions).toContain("company_documents_search");
  });
});

describe("ensureLegalBot", () => {
  it("gives two members of one default space two separate locked bots", async () => {
    const prisma = fakeDb(DEFAULT, []);
    const first = await ensureLegalBot(prisma as never, { spaceId: "default", userId: "user-1" });
    const second = await ensureLegalBot(prisma as never, { spaceId: "default", userId: "user-2" });
    expect(first?.spawnKey).toBe(legalBotSpawnKey("user-1"));
    expect(second?.spawnKey).toBe(legalBotSpawnKey("user-2"));
    expect(first?.id).not.toBe(second?.id);
    expect(sink.created).toHaveLength(2);
    expect(sink.created.every((bot) => bot.locked === true)).toBe(true);
  });

  it("keeps one bot when called twice for the same member", async () => {
    const prisma = fakeDb(DEFAULT, []);
    await ensureLegalBot(prisma as never, { spaceId: "default", userId: "user-1" });
    const again = await ensureLegalBot(prisma as never, { spaceId: "default", userId: "user-1" });
    expect(sink.created).toHaveLength(1);
    expect(again?.spawnKey).toBe(legalBotSpawnKey("user-1"));
  });

  it("converts a legacy shared bot owned by the same user instead of duplicating it", async () => {
    const bots: Row[] = [
      {
        id: "legacy",
        spaceId: "default",
        userId: "user-1",
        spawnKey: LEGACY_LEGAL_BOT_SPAWN_KEY,
        locked: false,
        instructions: "old",
      },
    ];
    const prisma = fakeDb(DEFAULT, bots);
    const bot = await ensureLegalBot(prisma as never, { spaceId: "default", userId: "user-1" });
    expect(sink.created).toHaveLength(0);
    expect(bot).toMatchObject({
      id: "legacy",
      spawnKey: legalBotSpawnKey("user-1"),
      locked: true,
      instructions: LEGAL_BOT.instructions,
    });
    expect(bots).toHaveLength(1);
  });

  it("does not take over a legacy bot owned by someone else", async () => {
    const bots: Row[] = [
      {
        id: "legacy",
        spaceId: "default",
        userId: "user-1",
        spawnKey: LEGACY_LEGAL_BOT_SPAWN_KEY,
        locked: true,
        instructions: LEGAL_BOT.instructions,
      },
    ];
    const prisma = fakeDb(DEFAULT, bots);
    await ensureLegalBot(prisma as never, { spaceId: "default", userId: "user-2" });
    expect(sink.created).toHaveLength(1);
    expect(bots[0]!.spawnKey).toBe(LEGACY_LEGAL_BOT_SPAWN_KEY);
  });

  it("gives a non-default space nothing", async () => {
    const prisma = fakeDb({ team: { isDefault: false } }, []);
    await expect(
      ensureLegalBot(prisma as never, { spaceId: "team", userId: "user-1" }),
    ).resolves.toBeNull();
    expect(sink.created).toHaveLength(0);
  });

  it("refreshes the instructions of an existing locked bot", async () => {
    const bots: Row[] = [
      {
        id: "b1",
        spaceId: "default",
        userId: "u1",
        spawnKey: legalBotSpawnKey("u1"),
        locked: true,
        instructions: "stale",
      },
    ];
    const prisma = fakeDb(DEFAULT, bots);
    await ensureLegalBot(prisma as never, { spaceId: "default", userId: "u1" });
    expect(bots[0]!.instructions).toBe(LEGAL_BOT.instructions);
  });
});

describe("ensureLegalBotForActor", () => {
  it("creates nothing when the actor's Legal bot already exists", async () => {
    const bots: Row[] = [
      {
        id: "b1",
        spaceId: "default",
        userId: "u1",
        spawnKey: legalBotSpawnKey("u1"),
        locked: true,
        instructions: LEGAL_BOT.instructions,
      },
    ];
    const prisma = fakeDb(DEFAULT, bots);
    await ensureLegalBotForActor(prisma as never, { spaceId: "default", userId: "u1" });
    expect(sink.created).toHaveLength(0);
    expect(prisma.bot.update).not.toHaveBeenCalled();
    expect(prisma.space.findUnique).not.toHaveBeenCalled();
    expect(prisma.bot.findUnique).toHaveBeenCalledTimes(1);
  });

  it("provisions the bot for a member who has none", async () => {
    const prisma = fakeDb(DEFAULT, []);
    await ensureLegalBotForActor(prisma as never, { spaceId: "default", userId: "new-member" });
    expect(sink.created).toHaveLength(1);
    expect(sink.created[0]!.spawnKey).toBe(legalBotSpawnKey("new-member"));
  });
});
