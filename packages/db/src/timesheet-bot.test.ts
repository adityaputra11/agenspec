import { describe, expect, it, vi } from "vitest";

const sink = vi.hoisted(() => ({
  bots: [] as Array<Record<string, unknown>>,
  servers: [] as Array<Record<string, unknown>>,
  assignments: [] as Array<Record<string, unknown>>,
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
            update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(bot, data),
          },
          mcpServer: {
            upsert: async ({
              where,
              create,
              update,
            }: {
              where: { spaceId_userId_slug: Record<string, string> };
              create: Record<string, unknown>;
              update: Record<string, unknown>;
            }) => {
              const key = where.spaceId_userId_slug;
              let server = sink.servers.find(
                (row) =>
                  row.spaceId === key.spaceId && row.userId === key.userId && row.slug === key.slug,
              );
              if (server) Object.assign(server, update);
              else {
                server = { id: `server-${sink.servers.length + 1}`, ...create };
                sink.servers.push(server);
              }
              return server;
            },
          },
          botMcpServer: {
            upsert: async ({
              where,
              create,
            }: {
              where: { botId_serverId: { botId: string; serverId: string } };
              create: Record<string, unknown>;
            }) => {
              const { botId, serverId } = where.botId_serverId;
              const existing = sink.assignments.find(
                (row) => row.botId === botId && row.serverId === serverId,
              );
              if (!existing) sink.assignments.push({ ...create });
              return existing ?? create;
            },
          },
        },
        bot.id as string,
      );
      return bot;
    },
  }),
}));

import {
  ensureTimesheetBotForActor,
  TIMESHEET_BOT,
  timesheetBotSpawnKey,
} from "./timesheet-bot.js";

const URL = "https://example.test/mcp";
const actor = { spaceId: "space-1", userId: "user-1" };

/** An in-memory stand-in for the tables ensureTimesheetBotForActor reads and writes. */
function fakeDb(timesheetServerUrl: string | null) {
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
    },
    space: {
      findUnique: vi.fn(async () => ({ organizationId: "org-1", deletingAt: null, isDefault: true })),
    },
    organizationPolicy: {
      findUnique: vi.fn(async () => ({ timesheetServerUrl })),
    },
  };
}

function reset() {
  sink.bots = [];
  sink.servers = [];
  sink.assignments = [];
  sink.creates = 0;
}

describe("ensureTimesheetBotForActor", () => {
  it("does nothing when the organization has no Timesheet server", async () => {
    reset();
    await ensureTimesheetBotForActor(fakeDb(null) as any, actor);
    expect(sink.creates).toBe(0);
    expect(sink.servers).toHaveLength(0);
  });

  it("creates a locked bot, its server and its assignment once", async () => {
    reset();
    const prisma = fakeDb(URL) as any;
    await ensureTimesheetBotForActor(prisma, actor);
    await ensureTimesheetBotForActor(prisma, actor);

    expect(sink.creates).toBe(1);
    expect(sink.bots[0]).toMatchObject({
      spawnKey: timesheetBotSpawnKey(actor.userId),
      locked: true,
    });
    expect(sink.servers).toHaveLength(1);
    expect(sink.servers[0]).toMatchObject({
      slug: "timesheet",
      name: TIMESHEET_BOT.name,
      transport: "streamable_http",
      endpoint: URL,
      enabled: true,
    });
    expect(sink.assignments).toEqual([
      expect.objectContaining({ botId: sink.bots[0]!.id, serverId: sink.servers[0]!.id }),
    ]);
  });
});
