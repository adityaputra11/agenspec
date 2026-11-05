import { describe, expect, it, vi } from "vitest";

const sink = vi.hoisted(() => ({
  bots: [] as Array<Record<string, unknown>>,
  creates: 0,
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
      sink.creates += 1;
      const bot: Record<string, unknown> = {
        id: `bot-${sink.creates}`,
        userId: actor.userId,
        spaceId: actor.spaceId,
        spawnKey: input.spawnKey,
        locked: false,
      };
      sink.bots.push(bot);
      await input.seed?.(
        {
          bot: {
            update: async ({ data }: { data: Record<string, unknown> }) =>
              Object.assign(bot, data),
          },
        },
        bot.id as string,
      );
      return bot;
    },
  }),
}));

import {
  ensureSupportBot,
  ensureSupportBotForActor,
  SUPPORT_BOT,
  supportBotSpawnKey,
} from "./support-bot.js";

const actor = { spaceId: "space-1", userId: "user-1" };

/** An in-memory stand-in for the tables ensureSupportBotForActor reads and writes. */
function fakeDb(isDefault: boolean) {
  return {
    bot: {
      findUnique: vi.fn(
        async ({ where }: { where: { spaceId_spawnKey: Record<string, string> } }) => {
          const key = where.spaceId_spawnKey;
          return (
            sink.bots.find((bot) => bot.spaceId === key.spaceId && bot.spawnKey === key.spawnKey) ??
            null
          );
        },
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const bot = sink.bots.find((row) => row.id === where.id)!;
        return Object.assign(bot, data);
      }),
    },
    space: {
      findUnique: vi.fn(async () => ({ isDefault, deletingAt: null })),
    },
  };
}

function reset() {
  sink.bots = [];
  sink.creates = 0;
}

describe("ensureSupportBotForActor", () => {
  it("creates a locked bot once", async () => {
    reset();
    const prisma = fakeDb(true) as any;
    await ensureSupportBotForActor(prisma, actor);
    await ensureSupportBotForActor(prisma, actor);

    expect(sink.creates).toBe(1);
    expect(sink.bots[0]).toMatchObject({
      spawnKey: supportBotSpawnKey(actor.userId),
      locked: true,
    });
  });

  it("does nothing outside a default space", async () => {
    reset();
    await ensureSupportBotForActor(fakeDb(false) as any, actor);
    expect(sink.creates).toBe(0);
  });

  it("refreshes outdated instructions on an existing bot", async () => {
    reset();
    sink.bots.push({
      id: "bot-old",
      userId: actor.userId,
      spaceId: actor.spaceId,
      spawnKey: supportBotSpawnKey(actor.userId),
      locked: false,
      instructions: "stale",
    });
    await ensureSupportBot(fakeDb(true) as any, actor);

    expect(sink.creates).toBe(0);
    expect(sink.bots[0]).toMatchObject({ locked: true, instructions: SUPPORT_BOT.instructions });
  });
});
