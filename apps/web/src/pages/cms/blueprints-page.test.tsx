// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../lib/rpc", () => {
  const client = { cms: { blueprints: api } };
  return {
    rpc: client,
    rpcForSpace: () => client,
    createSpaceRpc: () => client,
    selectedSpaceId: () => null,
  };
});
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values);
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo/ui-web", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
      <button type="button" {...props} />
    ),
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    Label: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
      <label htmlFor={htmlFor}>{children}</label>
    ),
    Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
    Spinner: () => null,
    toast: { error: vi.fn(), success: vi.fn() },
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogContent: Pass,
    DialogHeader: Pass,
    DialogFooter: Pass,
    DialogTitle: Pass,
    AlertDialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    AlertDialogContent: Pass,
    AlertDialogHeader: Pass,
    AlertDialogFooter: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogCancel: Pass,
    AlertDialogAction: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

import type { AgentBlueprint } from "@rakazo/contracts";
import { SPEC_BLUEPRINT_TEMPLATE } from "@rakazo/contracts";
import { BlueprintsPage } from "./blueprints-page";

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
let queryClient = newClient();

afterEach(() => {
  queryClient.clear();
  queryClient = newClient();
  vi.clearAllMocks();
});

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function show(root: Root, node: ReactNode) {
  await act(async () =>
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>),
  );
  await settle();
}

function buttonWith(container: HTMLElement, text: string) {
  const found = [...container.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

const blueprint: AgentBlueprint = {
  id: "bp-1",
  name: "Legal review",
  description: "Reviews contracts",
  instructions: "Review every clause.",
  referenceNames: ["Design Approval", "Proposal"],
  updatedAt: "2026-11-01T00:00:00.000Z",
};

it("renders blueprints with their reference names", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.list.mockResolvedValue([blueprint]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await show(root, <BlueprintsPage />);
    expect(container.textContent).toContain("Legal review");
    expect(container.textContent).toContain("Design Approval · Proposal");
    expect(container.textContent).not.toContain("Use Spec template");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("prefills the editor from the Spec template when the list is empty", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.list.mockResolvedValue([]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await show(root, <BlueprintsPage />);
    await act(async () => buttonWith(container, "Use Spec template").click());
    expect(container.querySelector<HTMLInputElement>("#blueprint-name")?.value).toBe("Spec");
    expect(container.querySelector<HTMLTextAreaElement>("#blueprint-instructions")?.value).toBe(
      SPEC_BLUEPRINT_TEMPLATE.instructions,
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("creates a blueprint with the form values when saved", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.list.mockResolvedValue([]);
  api.create.mockResolvedValue(blueprint);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const setValue = (selector: string, value: string) => {
    const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!field) throw new Error(`Missing field: ${selector}`);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  try {
    await show(root, <BlueprintsPage />);
    await act(async () => buttonWith(container, "New blueprint").click());
    await act(async () => setValue("#blueprint-name", "Legal review"));
    await act(async () => setValue("#blueprint-description", "Reviews contracts"));
    await act(async () => setValue("#blueprint-instructions", "Review every clause."));
    await act(async () => setValue('input[aria-label="Reference document 1"]', "Proposal"));
    await act(async () => buttonWith(container, "Save").click());
    expect(api.create).toHaveBeenCalledWith({
      name: "Legal review",
      description: "Reviews contracts",
      instructions: "Review every clause.",
      referenceNames: ["Proposal"],
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
