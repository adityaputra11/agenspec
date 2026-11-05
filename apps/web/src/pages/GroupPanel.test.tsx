// @vitest-environment jsdom

import type { Bot, Group, GroupPerson } from "@rakazo/contracts";
import type * as UiWeb from "@rakazo/ui-web";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
// The alert dialog's Cancel closes it through onOpenChange, as Base UI does.
let dismissDialog: (() => void) | undefined;
vi.mock("@rakazo/ui-web", async (importOriginal) => {
  const { Checkbox } = await importOriginal<typeof UiWeb>();
  return {
    Checkbox,
    BotAvatar: () => <span />,
    SectionHeading: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
    Button: (props: ComponentProps<"button">) => <button {...props} />,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
    AlertDialog: ({
      children,
      onOpenChange,
    }: {
      children: ReactNode;
      onOpenChange: (open: boolean) => void;
    }) => {
      dismissDialog = () => onOpenChange(false);
      return <div role="alertdialog">{children}</div>;
    },
    AlertDialogAction: (props: ComponentProps<"button">) => <button {...props} />,
    AlertDialogCancel: (props: ComponentProps<"button">) => (
      <button {...props} onClick={() => dismissDialog?.()} />
    ),
    AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  };
});

import { GroupSettings } from "./GroupPanel";

const group: Group = {
  id: "group-1",
  spaceId: "space-1",
  name: "Review team",
  pinned: false,
  sectionId: null,
  archivedAt: null,
  members: [
    { botId: "bot-1", name: "Researcher", color: "blue" },
    { botId: "bot-2", name: "Writer", color: "green" },
  ],
  threadId: "thread-1",
  preview: "",
  unread: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

function fakeBot(id: string, name: string): Bot {
  return {
    id,
    spaceId: "space-1",
    name,
    title: "",
    description: "",
    instructions: "",
    color: "blue",
    notifyOnFinish: true,
    pinned: false,
    sectionId: null,
    archivedAt: null,
    unread: false,
    parentBotId: null,
    memoryScope: null,
    threadId: `thread-${id}`,
    preview: "",
    status: "idle",
    runErrorId: null,
    computerMode: "team",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    voiceId: null,
    autoSpeak: false,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    teamChatAmbientEnabled: false,
    teamChatRules: "",
    disabledBuiltinTools: [],
    webhookConfigured: false,
    fleetManagement: false,
    spawnKey: null,
    locked: false,
  };
}

const bots = [
  fakeBot("bot-1", "Researcher"),
  fakeBot("bot-2", "Writer"),
  fakeBot("bot-3", "Runner"),
];

const dewi: GroupPerson = { userId: "user-dewi", name: "Dewi", email: "dewi@example.com" };
const budi: GroupPerson = { userId: "user-budi", name: "Budi", email: "budi@example.com" };

async function render(
  options: {
    onSave?: ComponentProps<typeof GroupSettings>["onSave"];
    onSavePeople?: (userIds: string[]) => Promise<void>;
    loadCandidates?: () => Promise<GroupPerson[]>;
    group?: Group;
    onRemove?: () => Promise<void>;
    onLeave?: () => Promise<void>;
    viewerId?: string;
    covered?: boolean;
    instance?: string;
    bots?: ComponentProps<typeof GroupSettings>["bots"];
    onOpenBot?: (botId: string) => void;
  } = {},
) {
  const onRemove = vi.fn(options.onRemove ?? (async () => undefined));
  const onLeave = vi.fn(options.onLeave ?? (async () => undefined));
  const onSavePeople = vi.fn(options.onSavePeople ?? (async () => undefined));
  const onClose = vi.fn();
  await act(async () => {
    root.render(
      <GroupSettings
        key={options.instance}
        group={options.group ?? group}
        bots={options.bots ?? bots}
        viewerId={options.viewerId}
        onSave={options.onSave ?? (async () => undefined)}
        onSavePeople={onSavePeople}
        loadCandidates={options.loadCandidates ?? (async () => [dewi, budi])}
        onRemove={onRemove}
        onLeave={onLeave}
        onClose={onClose}
        onOpenBot={options.onOpenBot}
        covered={options.covered}
      />,
    );
  });
  return { onRemove, onLeave, onSavePeople, onClose };
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent === name,
  );
  if (!found) throw new Error(`Missing ${name} button`);
  return found;
}

async function click(name: string) {
  await act(async () => {
    button(name).click();
    await Promise.resolve();
  });
}

async function pressEscape(composition: KeyboardEventInit = {}) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true, ...composition }),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("GroupSettings", () => {
  it("follows a refreshed group in fields not edited and keeps the ones that were", async () => {
    const onSave = vi.fn(async () => undefined);
    await render({ onSave });
    const name = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        name,
        "My edit",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const refreshed = {
      ...group,
      name: "Renamed elsewhere",
      members: [...group.members, { botId: "bot-3", name: "Runner", color: "blue" }],
    };
    await render({ onSave, group: refreshed });
    expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("My edit");
    await click("Save");
    expect(onSave).toHaveBeenCalledWith({ name: "My edit", botIds: undefined });
  });

  it("closes from the header button", async () => {
    const { onClose } = await render();
    await click("Close panel");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const { onClose } = await render();
    await pressEscape();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves Escape to an input method that is composing", async () => {
    const { onClose } = await render();
    await pressEscape({ isComposing: true });
    await pressEscape({ keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape to an overlay on top of the panel", async () => {
    const { onClose } = await render({ covered: true });
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open until a save in flight finishes, then closes", async () => {
    let finishSave!: () => void;
    const { onClose } = await render({
      onSave: () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    });
    await click("Save");
    expect(button("Close panel").disabled).toBe(true);
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finishSave());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("saves group instructions only when they changed", async () => {
    const onSave = vi.fn(async () => undefined);
    await render({ onSave });
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("instructions field not found");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setValue?.call(textarea, "  Only reply to greetings here.  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Save");
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: "Only reply to greetings here." }),
    );
  });

  it("stays open with the error when the save fails", async () => {
    const { onClose } = await render({
      onSave: async () => {
        throw new Error("Name is taken");
      },
    });
    await click("Save");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Name is taken");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close the panel of a chat opened while the save was in flight", async () => {
    let finishSave!: () => void;
    const first = await render({
      onSave: () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    });
    await click("Save");
    const second = await render({ instance: "another chat" });
    await act(async () => finishSave());
    expect(first.onClose).not.toHaveBeenCalled();
    expect(second.onClose).not.toHaveBeenCalled();
  });

  it("asks before deleting the group", async () => {
    const { onRemove } = await render();
    await click("Delete group");
    expect(onRemove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "Delete Review team?",
    );
    await click("Delete");
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("keeps the group and the panel when the confirmation is dismissed", async () => {
    const { onRemove, onClose } = await render();
    await click("Delete group");
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    await click("Cancel");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  const rowNames = () =>
    [...container.querySelectorAll('[role="checkbox"]')].map((el) => el.parentElement?.textContent);

  it("shows only group members until Show all expands the roster", async () => {
    await render();
    expect(rowNames()).toEqual(["Researcher", "Writer"]);
    await click("Show all");
    expect(rowNames()).toEqual(["Researcher", "Writer", "Runner"]);
    await click("Show selected");
    expect(rowNames()).toEqual(["Researcher", "Writer"]);
  });

  it("filters the expanded roster by name", async () => {
    await render();
    await click("Show all");
    const filter = container.querySelector('input[aria-label="Filter bots"]');
    expect(filter).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(filter, "  WRIT ");
      filter!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(rowNames()).toEqual(["Writer"]);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(filter, "zzz");
      filter!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("No bots match");
    await click("Show selected");
    expect(rowNames()).toEqual(["Researcher", "Writer"]);
    expect(container.querySelector('input[aria-label="Filter bots"]')).toBeNull();
  });

  it("opens the bot profile from the name and keeps unchecked members listed", async () => {
    const onOpenBot = vi.fn();
    await render({ onOpenBot });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((el) => el.textContent === "Researcher")!
        .click();
      await Promise.resolve();
    });
    expect(onOpenBot).toHaveBeenCalledWith("bot-1");
    await act(async () => {
      container
        .querySelector<HTMLElement>('[role="checkbox"][aria-label^="Remove Researcher"]')!
        .click();
      await Promise.resolve();
    });
    expect(rowNames()).toEqual(["Researcher", "Writer"]);
    const unchecked = container.querySelector<HTMLElement>(
      '[role="checkbox"][aria-label="Add Researcher to the group"]',
    );
    expect(unchecked?.getAttribute("aria-checked")).toBe("false");
    await act(async () => unchecked!.click());
    expect(
      container
        .querySelector('[role="checkbox"][aria-label="Remove Researcher from the group"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("lets the owner add people from the candidates and saves the full list", async () => {
    const onSavePeople = vi.fn(async () => undefined);
    const loadCandidates = vi.fn(async () => [dewi, budi]);
    await render({ viewerId: "user-owner", onSavePeople, loadCandidates });
    await click("Add people");
    expect(loadCandidates).toHaveBeenCalledOnce();
    await act(async () => {
      container
        .querySelector<HTMLElement>('[role="checkbox"][aria-label="Add Dewi to the group"]')!
        .click();
      await Promise.resolve();
    });
    await click("Save");
    expect(onSavePeople).toHaveBeenCalledWith(["user-dewi"]);
  });

  it("removes a shared person from the owner's list before saving", async () => {
    const onSavePeople = vi.fn(async () => undefined);
    const shared = { ...group, ownerUserId: "user-owner", people: [dewi, budi] };
    await render({ viewerId: "user-owner", group: shared, onSavePeople });
    expect(container.textContent).toContain("dewi@example.com");
    await click("Remove Dewi");
    await click("Save");
    expect(onSavePeople).toHaveBeenCalledWith(["user-budi"]);
  });

  it("does not call people save when the list did not change", async () => {
    const onSavePeople = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const shared = { ...group, ownerUserId: "user-owner", people: [dewi] };
    await render({ viewerId: "user-owner", group: shared, onSavePeople });
    await click("Save");
    expect(onSavePeople).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a non-owner the group read-only with Leave group and no Save", async () => {
    const shared = { ...group, ownerUserId: "user-owner", people: [dewi] };
    const { onSavePeople } = await render({ viewerId: "user-dewi", group: shared });
    expect(container.textContent).not.toContain("Save");
    expect(container.textContent).not.toContain("Add people");
    expect(container.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(container.textContent).toContain("Researcher");
    expect(container.querySelector('[aria-label^="Remove "]')).toBeNull();
    expect(onSavePeople).not.toHaveBeenCalled();
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
  });

  it("confirms before leaving, then calls leave", async () => {
    const shared = { ...group, ownerUserId: "user-owner" };
    const { onLeave, onClose } = await render({ viewerId: "user-dewi", group: shared });
    await click("Leave group");
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Leave this group?");
    expect(dialog?.textContent).toContain("You stop seeing its messages.");
    expect(onLeave).not.toHaveBeenCalled();
    await act(async () => {
      [...dialog!.querySelectorAll("button")]
        .find((el) => el.textContent === "Leave group")!
        .click();
      await Promise.resolve();
    });
    expect(onLeave).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
