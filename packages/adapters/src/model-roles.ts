import type { AgentRunRequest, SecretStore } from "@rakazo/adapter-kit";
import type {
  ModelRole,
  ModelRoleChoice,
  ModelRoleSettings,
  SettingsScope,
} from "@rakazo/contracts";
import { backupChoiceKey, usableModelId } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { appliedModelRole } from "@rakazo/db";
import { resolveAutoReviewChecker } from "./auto-review.js";
import type { ModelChoice, ModelCredential } from "./model-selection.js";
import { findConnectedModelCredential } from "./model-selection.js";
import type { OrganizationProviderPolicy } from "./organization-model.js";
import { memberMayUseProvider } from "./organization-model.js";

/** The deployment's configuration that stands in for a member who chose nothing. */
export type DeploymentModelDefaults = {
  /** The owner's saved default, ahead of the environment's. */
  settings?: { defaultModelProvider: string | null; defaultModelId: string | null } | null;
  /** The environment's model, when the deployment can run it. */
  deployment?: { provider: string; model: string } | null;
  env?: NodeJS.ProcessEnv;
};

/** What runs for a purpose without a member's choice, in the same shape as one. */
export function deploymentModelRole(
  role: ModelRole,
  defaults: DeploymentModelDefaults,
): ModelRoleSettings {
  if (role === "approval") {
    const checker = resolveAutoReviewChecker(defaults.env);
    return {
      primary: checker ? { provider: checker.provider, modelId: checker.model } : null,
      backups: [],
    };
  }
  // No computer model means the main model works the screen itself.
  if (role === "computer") return { primary: null, backups: [] };
  const provider = defaults.settings?.defaultModelProvider ?? defaults.deployment?.provider;
  const modelId =
    usableModelId(defaults.settings?.defaultModelId) ?? usableModelId(defaults.deployment?.model);
  return { primary: provider && modelId ? { provider, modelId } : null, backups: [] };
}

export type EffectiveModelRole = ModelRoleSettings & {
  /** Whose model leads: the member's own, the deployment's, or nobody's. */
  primarySource: "member" | "deployment" | null;
};

/** The member's ordered models for a purpose, with the deployment's filling what they left empty. */
export async function effectiveModelRole(
  prisma: Pick<
    PrismaClient,
    "spaceModelRoleChoice" | "userModelRoleChoice" | "spaceSettingOverride"
  >,
  scope: { userId: string; spaceId: string },
  role: ModelRole,
  defaults: DeploymentModelDefaults,
  requested?: SettingsScope,
): Promise<EffectiveModelRole> {
  const own = await appliedModelRole(prisma, scope, role, requested);
  if (own.primary) return { ...own, primarySource: "member" };
  const deployment = deploymentModelRole(role, defaults);
  return {
    primary: deployment.primary,
    backups: own.backups.length ? own.backups : deployment.backups,
    primarySource: deployment.primary ? "deployment" : null,
  };
}

export type MemberMainModel = ModelRoleChoice & {
  /** The connection that serves it; null when only the deployment can. */
  credential: ModelCredential;
};

/** The member's main model and the connection that serves it, resolved as validation does. */
export async function resolveMemberMainModel(
  deps: { prisma: PrismaClient; secretStore: Pick<SecretStore, "load"> },
  scope: { userId: string; spaceId: string },
): Promise<MemberMainModel | null> {
  const { primary } = await appliedModelRole(deps.prisma, scope, "main");
  if (!primary) return null;
  const credential = await findConnectedModelCredential(
    deps.prisma,
    deps.secretStore,
    scope,
    primary.provider,
    primary.modelId,
    { credentialId: primary.credentialId },
  );
  return { ...primary, credential };
}

/** Where the selected model comes from; an organization model runs on the organization's connection. */
export type ModelSource = "override" | "main" | "organization" | "deployment";

/** Select configuration without loading secrets or applying a runtime-specific fallback. */
export function selectConfiguredModel(input: {
  /** The bot's or the run's own model; null follows the main model. */
  override: ModelChoice | null;
  hostedProvider?: string;
  overrideCredential: ModelCredential;
  main: MemberMainModel | null;
  /** The organization's model, which runs after a member's own and before the deployment's. */
  organization?: (OrganizationProviderPolicy & { provider: string; modelId: string }) | null;
  defaults: DeploymentModelDefaults;
}) {
  const { override: bot, overrideCredential, main, organization } = input;
  const hasOverride = Boolean(bot?.modelProvider && usableModelId(bot.modelId));
  // A model runs on its own connection, or on the deployment's for its funded provider.
  const runnable = (provider: string | null | undefined, credential: ModelCredential) =>
    Boolean(credential || (provider && provider === input.hostedProvider));
  // When the organization restricts providers, a member's connection to an unlisted one never runs.
  const memberAllowed = (provider: string | null | undefined) =>
    memberMayUseProvider(organization, provider ?? "");
  // The override provider, model and credential must win together.
  const useOverride =
    hasOverride &&
    memberAllowed(bot?.modelProvider) &&
    runnable(bot?.modelProvider, overrideCredential);
  const useMain =
    !useOverride &&
    main !== null &&
    memberAllowed(main.provider) &&
    runnable(main.provider, main.credential);
  const fallback = deploymentModelRole("main", input.defaults).primary;
  const selected: {
    provider: string | null | undefined;
    id: string | null;
    credential: ModelCredential;
    source: ModelSource | null;
  } = useOverride
    ? {
        provider: bot!.modelProvider!,
        id: usableModelId(bot!.modelId),
        credential: overrideCredential,
        source: "override",
      }
    : useMain
      ? { provider: main.provider, id: main.modelId, credential: main.credential, source: "main" }
      : organization
        ? {
            provider: organization.provider,
            id: organization.modelId,
            credential: null,
            source: "organization",
          }
        : {
            provider: fallback?.provider,
            id: fallback?.modelId ?? null,
            credential: null,
            source: fallback ? "deployment" : null,
          };
  // The main model's effort belongs to that model, so an override of the same model keeps it.
  const mainThinking =
    main &&
    selected.source !== "organization" &&
    selected.id &&
    backupChoiceKey(main) ===
      backupChoiceKey({ provider: selected.provider ?? "", modelId: selected.id })
      ? (main.thinkingLevel ?? null)
      : null;
  return {
    ...selected,
    // Preserve bot thinking for the main model; drop it for an unavailable override.
    thinkingLevel:
      hasOverride && !useOverride
        ? null
        : (((bot?.thinkingLevel ?? mainThinking) as AgentRunRequest["model"]["thinkingLevel"]) ??
          null),
  };
}
