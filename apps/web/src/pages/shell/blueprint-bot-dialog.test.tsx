// @vitest-environment jsdom

import type { Bot } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/rpc", () => {
  const rpc = {
    blueprints: { createBot: vi.fn() },
  };
  return { rpc };
});
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { rpc } from "../../lib/rpc";
import { BlueprintBotDialog } from "./blueprint-bot-dialog";

const blueprints = [
  { id: "bp-1", name: "Spec", description: "", referenceNames: [] },
  { id: "bp-2", name: "Review", description: "", referenceNames: [] },
];

const createdBot = { id: "bot-9", name: "Ada" } as unknown as Bot;

let container: HTMLDivElement;
let root: Root;

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render(list: typeof blueprints, onCreated = vi.fn(async () => undefined)) {
  await act(async () => {
    root.render(
      <BlueprintBotDialog blueprints={list} onCancel={() => undefined} onCreated={onCreated} />,
    );
  });
  return onCreated;
}

async function typeName(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function createButton() {
  return [...document.querySelectorAll("button")].find(
    (element) => element.textContent === "Create",
  )!;
}

describe("BlueprintBotDialog", () => {
  it("creates a bot from the chosen blueprint and typed name", async () => {
    vi.mocked(rpc.blueprints.createBot).mockResolvedValue(createdBot);
    const onCreated = await render(blueprints);

    const select = document.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "bp-2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await typeName("Ada");
    await act(async () => {
      createButton().click();
    });

    expect(rpc.blueprints.createBot).toHaveBeenCalledWith({ blueprintId: "bp-2", name: "Ada" });
    expect(onCreated).toHaveBeenCalledWith(createdBot);
  });

  it("hides the picker when there is only one blueprint", async () => {
    await render([blueprints[0]!]);
    expect(document.querySelector("select")).toBeNull();
  });

  it("keeps Create disabled until a name is typed", async () => {
    await render([blueprints[0]!]);
    expect(createButton().disabled).toBe(true);
    await typeName("Ada");
    expect(createButton().disabled).toBe(false);
  });
});
