// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../../lib/rpc", () => {
  const client = { cms: { policy: api } };
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
  return {
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
      <button type="button" {...props} />
    ),
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    Spinner: () => null,
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: Omit<ComponentProps<"input">, "onChange"> & {
      checked?: boolean;
      onCheckedChange?: (checked: boolean) => void;
    }) => (
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        {...props}
      />
    ),
    toast: { error: vi.fn(), success: vi.fn() },
  };
});

import { AppsPage } from "./apps-page";

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

it("saves the Timesheet server URL", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.get.mockResolvedValue({ restrictApps: false, allowedApps: [], timesheetServerUrl: null });
  api.update.mockResolvedValue({ restrictApps: false, allowedApps: [], timesheetServerUrl: null });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await show(root, <AppsPage />);
    const input = container.querySelector<HTMLInputElement>('input[type="url"]');
    expect(input).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "https://example.test/mcp");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
    await act(async () => save!.click());
    await settle();
    expect(api.update).toHaveBeenCalledWith({
      restrictApps: false,
      allowedApps: [],
      timesheetServerUrl: "https://example.test/mcp",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
