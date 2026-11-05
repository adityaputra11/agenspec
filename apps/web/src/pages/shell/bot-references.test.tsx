// @vitest-environment jsdom

import type { Bot, BotReference } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/rpc", () => {
  const rpc = {
    blueprints: {
      list: vi.fn(async () => []),
      createBot: vi.fn(),
      references: {
        list: vi.fn(async () => []),
        upload: vi.fn(),
        remove: vi.fn(),
      },
    },
  };
  return {
    rpc,
    rpcForSpace: () => rpc,
    createSpaceRpc: () => rpc,
    selectedSpaceId: () => null,
  };
});
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { rpc } from "../../lib/rpc";
import { BotReferences } from "./bot-references";

const bot = { id: "bot-1", name: "Spec", blueprintId: "bp-1" } as unknown as Bot;

const blueprint = {
  id: "bp-1",
  name: "Spec",
  description: "",
  referenceNames: ["Design Approval", "Proposal"],
};

function reference(overrides: Partial<BotReference>): BotReference {
  return {
    id: "ref-1",
    referenceName: "Design Approval",
    name: "approval.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    createdAt: "2026-09-01T00:00:00.000Z",
    status: "ready",
    error: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(rpc.blueprints.list).mockResolvedValue([blueprint]);
  vi.mocked(rpc.blueprints.references.list).mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <BotReferences bot={bot} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function rowFor(slot: string): HTMLElement {
  const label = [...document.querySelectorAll("div")].find(
    (element) => element.textContent === slot && element.className.includes("truncate"),
  );
  const row = label?.closest<HTMLElement>(".px-4");
  if (!row) throw new Error(`No row for ${slot}`);
  return row;
}

describe("BotReferences", () => {
  it("renders one row per blueprint slot, with Upload for an empty slot", async () => {
    vi.mocked(rpc.blueprints.references.list).mockResolvedValue([reference({})]);
    await render();

    expect(rowFor("Design Approval").textContent).toContain("approval.pdf");
    expect(rowFor("Design Approval").textContent).toContain("Ready");
    expect(rowFor("Proposal").textContent).toContain("Missing");
    expect(rowFor("Proposal").textContent).toContain("Upload");
    expect(rpc.blueprints.references.list).toHaveBeenCalledWith(
      { botId: "bot-1" },
      expect.anything(),
    );
  });

  it("uploads a picked file to the empty slot's referenceName", async () => {
    vi.mocked(rpc.blueprints.references.upload).mockResolvedValue(
      reference({ referenceName: "Proposal", id: "ref-2", name: "proposal.md" }),
    );
    await render();

    const uploadButton = [...rowFor("Proposal").querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Upload"),
    );
    expect(uploadButton).toBeDefined();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => undefined);
    await act(async () => {
      uploadButton!.click();
    });
    expect(clickSpy).toHaveBeenCalled();

    const file = new File(["# Proposal"], "proposal.md", { type: "text/markdown" });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(rpc.blueprints.references.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        referenceName: "Proposal",
        name: "proposal.md",
        mimeType: "text/markdown",
        contentBase64: btoa("# Proposal"),
      }),
    );
  });

  it("renders nothing when the blueprint is no longer listed", async () => {
    vi.mocked(rpc.blueprints.list).mockResolvedValue([]);
    await render();
    expect(container.querySelector('[data-testid="bot-references"]')).toBeNull();
  });
});
