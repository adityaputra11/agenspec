import type { Actor } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import type { ThreadTarget } from "../thread-target.js";
import { releaseComputerControl } from "./computer.js";
import { takeoverReleaser } from "./threads.js";

vi.mock("./computer.js", () => ({ releaseComputerControl: vi.fn().mockResolvedValue(undefined) }));

const actor = { spaceId: "space-1", userId: "user-1" } as Actor;

describe("takeoverReleaser", () => {
  const findFirst = vi.fn();
  const deps = { prisma: { run: { findFirst } } } as unknown as RouterDeps;

  beforeEach(() => {
    findFirst.mockReset();
    vi.mocked(releaseComputerControl).mockClear();
  });

  it("hands the screen back to the bot of a direct chat", async () => {
    const target = { kind: "bot", botId: "bot-1" } as ThreadTarget;
    await takeoverReleaser(deps, actor, target)("run-1");
    expect(releaseComputerControl).toHaveBeenCalledWith(deps, actor, "bot-1", "done", "run-1");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("hands the screen back to the group member whose run the reply steers", async () => {
    findFirst.mockResolvedValue({ botId: "bot-2" });
    const target = { kind: "group", memberBotIds: ["bot-1", "bot-2"] } as ThreadTarget;
    await takeoverReleaser(deps, actor, target)("run-2");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "run-2", spaceId: "space-1", userId: "user-1" },
      select: { botId: true },
    });
    expect(releaseComputerControl).toHaveBeenCalledWith(deps, actor, "bot-2", "done", "run-2");
  });

  it("leaves the owner's takeover alone when someone else in a shared group replies", async () => {
    // The run belongs to the bot's owner, so the actor's own-run lookup finds nothing.
    findFirst.mockResolvedValue(null);
    const target = { kind: "group", memberBotIds: ["bot-2"] } as ThreadTarget;
    await takeoverReleaser(deps, actor, target)("run-owned-by-someone-else");
    expect(releaseComputerControl).not.toHaveBeenCalled();
  });

  it("releases nothing when the run is gone", async () => {
    findFirst.mockResolvedValue(null);
    const target = { kind: "group", memberBotIds: ["bot-1"] } as ThreadTarget;
    await takeoverReleaser(deps, actor, target)("run-3");
    expect(releaseComputerControl).not.toHaveBeenCalled();
  });
});
