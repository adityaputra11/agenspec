import type { Actor, Bot } from "@rakazo/contracts";
import { BOT_COLORS } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { createRepos } from "./repos.js";
import { runAsSystem } from "./row-security.js";

/** The blueprint is missing or belongs to an organization other than the actor's. */
export class BlueprintNotFoundError extends Error {
  constructor() {
    super("Blueprint not found");
    this.name = "BlueprintNotFoundError";
  }
}

/**
 * Makes a bot from one of the actor's organization's blueprints. The bot keeps no instructions of
 * its own; it is linked to the blueprint and follows it. The returned bot carries the blueprintId.
 */
export async function createBotFromBlueprint(
  prisma: PrismaClient,
  actor: Actor,
  input: { blueprintId: string; name: string },
): Promise<Bot> {
  const blueprint = await runAsSystem("read a blueprint for a new bot", async () => {
    const space = await prisma.space.findUnique({
      where: { id: actor.spaceId },
      select: { organizationId: true },
    });
    if (!space) return null;
    return prisma.agentBlueprint.findFirst({
      where: { id: input.blueprintId, organizationId: space.organizationId },
      select: { id: true, description: true },
    });
  });
  if (!blueprint) throw new BlueprintNotFoundError();

  return createRepos(prisma).createBot(actor, {
    name: input.name,
    description: blueprint.description,
    instructions: "",
    notifyOnFinish: true,
    color: BOT_COLORS[0],
    // Inside the creation transaction, so the bot is never visible without its blueprint.
    seed: async (tx, botId) => {
      await tx.bot.update({ where: { id: botId }, data: { blueprintId: blueprint.id } });
    },
  });
}
