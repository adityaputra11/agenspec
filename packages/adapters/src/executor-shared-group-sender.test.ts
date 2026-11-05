import type { AgentRunRequest, MemoryReadRequest } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  acquireDedicatedScreenLeaseFence: async (
    _prisma: unknown,
    input: { computerId: string; botId: string; runId: string },
  ) => ({ ...input, fence: 7 }),
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

const OWNER_MEMORY = "Owner's door code is 4821";

/** One run in a shared group, woken by a message the given person wrote (null = older message). */
async function sharedGroupRun(input: { senderUserId: string | null }) {
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: "user",
    sourceMessageId: "source-1",
    leaseFence: 0,
  };
  const prisma = {
    $queryRaw: vi.fn(async () => []),
    user: { findUnique: vi.fn(async () => null) },
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(run, data);
        return { count: 1 };
      }),
    },
    chatGroup: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.botId,
        userId: run.userId,
        name: "Assistant",
        computerId: "computer-1",
        computer: { id: "computer-1", scope: "dedicated" },
      })),
      findMany: vi.fn(async () => []),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => []),
    },
    thread: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.threadId,
        groupId: "group-1",
        externalConversationId: null,
      })),
      update: vi.fn(async () => ({ nextMessageSeq: 2, nextEventSeq: 2 })),
    },
    message: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async ({ select }: { select: Record<string, boolean> }) => {
        if (select.senderUserId) return { senderUserId: input.senderUserId };
        return {
          id: run.sourceMessageId,
          clientNonce: null,
          role: "user",
          blocks: [{ kind: "text", text: "What is the door code?" }],
          threadId: run.threadId,
        };
      }),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: "message-1", ...data })),
    },
    event: { create: vi.fn(async () => ({ seq: 1 })) },
    task: {
      findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "Answer the question" })),
    },
    connection: { findMany: vi.fn(async () => []) },
    userModelPreference: { findFirst: vi.fn(async () => null) },
    userModelRoleChoice: { findMany: vi.fn(async () => []) },
    userModelCredential: { findFirst: vi.fn(async () => null) },
    space: { findUnique: vi.fn(async () => null) },
    organizationModelSettings: { findUnique: vi.fn(async () => null) },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        defaultModelProvider: "openrouter",
        defaultModelId: "fixture-model",
      })),
    },
    taughtSkill: { findMany: vi.fn(async () => []) },
    secret: { findMany: vi.fn(async () => []) },
    vaultCredential: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    scratchpadItem: { findMany: vi.fn(async () => []) },
    spaceSettingOverride: { findUnique: async () => null },
    userActionApprovalRule: { findMany: vi.fn(async () => []) },
    userActionAutoReviewPreference: { findUnique: vi.fn(async () => ({ enabled: false })) },
    externalEffect: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
    steeringMessage: { findFirst: vi.fn(async () => null) },
    externalConversation: { findUnique: vi.fn(async () => null) },
    externalMessage: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    messagingInstallation: { findUnique: vi.fn(async () => null) },
    messagingIdentity: { findMany: vi.fn(async () => []) },
  };
  let request: AgentRunRequest | undefined;
  const runtimeRun = vi.fn(async function* (next: AgentRunRequest) {
    request = next;
    yield { type: "done" as const, text: "Done" };
  });
  const executor = createRunExecutor({
    deploymentModelKey: "fixture-model-key",
    prisma: {
      ...prisma,
      $transaction: async (work: (tx: typeof prisma) => Promise<unknown>) => work(prisma),
    },
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    connector: {
      discoverTools: async () => [],
      resolveCall: async () => undefined,
      execute: async function* () {},
    },
    sandbox: { describe: () => ({ capabilities: { graphical: false } }) },
    memory: {
      describe: () => ({ capabilities: {} }),
      read: async (_request: MemoryReadRequest) => ({
        documents: [{ path: "MEMORY.md", content: OWNER_MEMORY, revision: "rev-1" }],
      }),
      search: async () => [],
      commit: vi.fn(async () => ({ revision: "rev-2" })),
      remove: vi.fn(async () => ({ removed: false })),
      exportMarkdown: async function* () {},
    },
    memoryProviders: { resolve: async () => null },
    events: {
      append: vi.fn(async () => undefined),
      notify: vi.fn(async () => undefined),
      pauseRunForInput: vi.fn(async () => true),
      finalizeRun: vi.fn(async () => ({ continuationRunId: null })),
    },
    jobs: { enqueue: vi.fn(async () => undefined) },
    secrets: [],
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  await executor.continueRun(run.id, "worker-1");
  if (!request) throw new Error("the run never reached the model");
  const context = [request.instructions, request.prompt].join("\n");
  return {
    sawOwnerState: context.includes(OWNER_MEMORY),
    toldNonOwner: context.includes("someone other than your owner"),
    tools: request.tools.map((tool) => tool.name),
  };
}

describe("shared group runs woken by someone other than the owner", () => {
  it("treats a run woken by another person's message as non-owner", async () => {
    const result = await sharedGroupRun({ senderUserId: "user-2" });
    expect(result.toldNonOwner).toBe(true);
    expect(result.sawOwnerState).toBe(false);
    expect(result.tools).not.toContain("remember");
  });

  it.each([
    ["the owner's own message", "user-1"],
    ["an older message with no sender recorded", null],
  ])("keeps owner context for %s", async (_who, senderUserId) => {
    const result = await sharedGroupRun({ senderUserId });
    expect(result.toldNonOwner).toBe(false);
    expect(result.sawOwnerState).toBe(true);
  });
});
