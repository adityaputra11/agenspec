import { Trans, useLingui } from "@lingui/react/macro";
import { isCloudflareModelProvider, OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  Spinner,
  Switch,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ModelConnectForm } from "../../components/ModelConnectForm";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import type { ModelCatalogEntry } from "../../lib/model-auth";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { providerLabel, sameApps } from "./shared";

/**
 * The organization model picks from the shared catalog, minus personal subscriptions (their sign-in
 * belongs to one person) and Cloudflare routing, which needs account fields the admin form does not take.
 */
export function organizationCatalog(catalog: ModelCatalogEntry[]): ModelCatalogEntry[] {
  return catalog.filter(
    (entry) => entry.auth !== "oauth" && !isCloudflareModelProvider(entry.provider),
  );
}

export function ModelsPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const settings = useQuery(queries.cms.models.get.queryOptions());
  // Unfiltered by the member allowlist, so the admin can pick any provider for the organization.
  const catalog = useQuery(queries.cms.models.catalog.queryOptions());
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const connected = settings.data?.connected ?? false;
  const modelCatalog = catalog.data ?? [];

  async function disconnect() {
    setDisconnecting(true);
    try {
      await rpc.cms.models.disconnect();
      await queryClient.invalidateQueries({ queryKey: queries.cms.models.get.key() });
      setConfirmDisconnect(false);
    } catch (err) {
      toast.error(errorText(err, t`Could not disconnect the model`));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-8">
      {settings.data ? (
        <SettingsGroup title={<Trans>Organization model</Trans>}>
          {connected ? (
            <SettingsRow
              label={
                <span className="block truncate">
                  {providerLabel(modelCatalog, settings.data.provider ?? "")} ·{" "}
                  {settings.data.modelId}
                </span>
              }
              control={
                <Button variant="outline" onClick={() => setConfirmDisconnect(true)}>
                  <Trans>Disconnect</Trans>
                </Button>
              }
            />
          ) : (
            <div className="px-4 py-3">
              <ModelConnectForm
                target="organization"
                hideSubscriptionSignIn
                catalog={organizationCatalog(modelCatalog)}
                onConnected={() =>
                  void queryClient.invalidateQueries({ queryKey: queries.cms.models.get.key() })
                }
                probeOpenAiCompatible={(input) =>
                  rpc.cms.models.probe({
                    provider: OPENAI_COMPATIBLE_PROVIDER_ID,
                    baseUrl: input.baseUrl,
                    apiKey: input.apiKey,
                    headers: input.headers,
                  })
                }
                probeCatalog={(input) => rpc.cms.models.probe(input)}
                connect={(input) =>
                  rpc.cms.models.connect({
                    provider: input.provider,
                    apiKey: input.apiKey,
                    baseUrl: input.baseUrl,
                    modelId: input.modelId ?? "",
                    headers: input.headers,
                  })
                }
                submitLabel={<Trans>Save</Trans>}
              />
            </div>
          )}
        </SettingsGroup>
      ) : null}

      {settings.data ? (
        <MemberProviders
          catalog={modelCatalog}
          restrict={settings.data.restrictMemberProviders}
          allowed={settings.data.allowedProviders}
        />
      ) : null}

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Disconnect this model?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>Members without their own model stop running bots.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disconnecting}
              onClick={(event) => {
                event.preventDefault();
                void disconnect();
              }}
            >
              <Trans>Disconnect</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemberProviders({
  catalog,
  restrict,
  allowed,
}: {
  catalog: ModelCatalogEntry[];
  restrict: boolean;
  allowed: string[];
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [restrictDraft, setRestrictDraft] = useState(restrict);
  const [allowedDraft, setAllowedDraft] = useState<string[]>(allowed);
  const [busy, setBusy] = useState(false);
  // One row per provider of the shared catalog, in catalog order.
  const providers = [...new Set(catalog.map((entry) => entry.provider))].map((id) => ({
    id,
    name: providerLabel(catalog, id),
  }));

  useEffect(() => {
    setRestrictDraft(restrict);
    setAllowedDraft(allowed);
  }, [restrict, allowed]);

  const changed = restrictDraft !== restrict || !sameApps(allowedDraft, allowed);

  async function save() {
    setBusy(true);
    try {
      await rpc.cms.models.setPolicy({
        restrictMemberProviders: restrictDraft,
        allowedProviders: allowedDraft,
      });
      await queryClient.invalidateQueries({ queryKey: queries.cms.models.get.key() });
    } catch (err) {
      toast.error(errorText(err, t`Could not save member providers`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SettingsGroup title={<Trans>Member providers</Trans>}>
        <SettingsRow
          label={<Trans>Only allow listed providers</Trans>}
          control={
            <Switch
              aria-label={t`Only allow listed providers`}
              checked={restrictDraft}
              onCheckedChange={(checked) => setRestrictDraft(checked)}
            />
          }
        />
      </SettingsGroup>
      <div className={restrictDraft ? "" : "opacity-60"}>
        <SettingsGroup>
          {providers.map((provider) => {
            const checked = allowedDraft.includes(provider.id);
            return (
              <SettingsRow
                key={provider.id}
                label={provider.name}
                control={
                  <Checkbox
                    aria-label={provider.name}
                    checked={checked}
                    disabled={!restrictDraft}
                    onCheckedChange={(next) =>
                      setAllowedDraft(
                        next === true
                          ? [...allowedDraft, provider.id]
                          : allowedDraft.filter((id) => id !== provider.id),
                      )
                    }
                  />
                }
              />
            );
          })}
        </SettingsGroup>
      </div>
      <div>
        <Button onClick={() => void save()} disabled={!changed || busy}>
          {busy ? <Spinner /> : null}
          <Trans>Save</Trans>
        </Button>
      </div>
    </>
  );
}
