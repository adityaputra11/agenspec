import { useLingui } from "@lingui/react/macro";
import {
  Brain,
  Building2,
  CloudDownload,
  Cpu,
  CreditCard,
  Gauge,
  KeyRound,
  MessageCircle,
  Monitor,
  Settings,
  ShieldCheck,
  Volume2,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import type { SettingsSection } from "./shell-overlay";

export type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

/** The settings sections this deployment offers, in nav order; Space opens from its own menu. */
export function useSettingsNavItems(available: {
  messaging: boolean;
  wallet: boolean;
  computer: boolean;
  billing: boolean;
  updates: boolean;
}): SettingsNavItem[] {
  const { t } = useLingui();
  return [
    { id: "general", label: t`General`, icon: Settings },
    { id: "organization", label: t`Organization`, icon: Building2 },
    { id: "models", label: t`Models`, icon: Cpu },
    { id: "voice", label: t`Voice`, icon: Volume2 },
    { id: "confirmations", label: t`Approvals`, icon: ShieldCheck },
    { id: "vault", label: t`Vault`, icon: KeyRound },
    ...(available.messaging
      ? [{ id: "messaging" as const, label: t`Messaging`, icon: MessageCircle }]
      : []),
    ...(available.wallet ? [{ id: "wallet" as const, label: t`Wallet`, icon: Wallet }] : []),
    { id: "memory", label: t`Memory`, icon: Brain },
    { id: "usage", label: t`Usage`, icon: Gauge },
    ...(available.computer ? [{ id: "computer" as const, label: t`Computer`, icon: Monitor }] : []),
    ...(available.billing ? [{ id: "billing" as const, label: t`Billing`, icon: CreditCard }] : []),
    ...(available.updates
      ? [{ id: "updates" as const, label: t`Updates`, icon: CloudDownload }]
      : []),
  ];
}

/** The class of one settings nav item: the active one is filled, the others are muted until hovered. */
export function settingsNavItemClass(active: boolean): string {
  return `flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13.5px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
    active
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-foreground"
  }`;
}
