import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input, Spinner, Switch, toast } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { APP_SLUG_PATTERN, sameApps } from "./shared";

export function AppsPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const policy = useQuery(queries.cms.policy.get.queryOptions());
  const [restrictApps, setRestrictApps] = useState(false);
  const [allowedApps, setAllowedApps] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!policy.data) return;
    setRestrictApps(policy.data.restrictApps);
    setAllowedApps(policy.data.allowedApps);
  }, [policy.data]);

  const changed =
    policy.data !== undefined &&
    (restrictApps !== policy.data.restrictApps || !sameApps(allowedApps, policy.data.allowedApps));

  function addApp() {
    const slug = draft.trim().toLowerCase();
    if (!slug) return;
    if (!APP_SLUG_PATTERN.test(slug)) {
      toast.error(t`Use letters, digits, dots, dashes and underscores`);
      return;
    }
    if (!allowedApps.includes(slug)) setAllowedApps([...allowedApps, slug]);
    setDraft("");
  }

  async function save() {
    setBusy(true);
    try {
      await rpc.cms.policy.update({ restrictApps, allowedApps });
      await queryClient.invalidateQueries({ queryKey: queries.cms.policy.get.key() });
    } catch (err) {
      toast.error(errorText(err, t`Could not save allowed apps`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <SettingsGroup>
        <SettingsRow
          label={<Trans>Only allow listed apps</Trans>}
          control={
            <Switch
              aria-label={t`Only allow listed apps`}
              checked={restrictApps}
              onCheckedChange={(checked) => setRestrictApps(checked)}
            />
          }
        />
      </SettingsGroup>

      <div className={restrictApps ? "" : "opacity-60"}>
        <SettingsGroup title={<Trans>Allowed apps</Trans>}>
          <SettingsRow
            label={
              <span className="sr-only">
                <Trans>Add app</Trans>
              </span>
            }
            control={
              <form
                className="flex w-full gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addApp();
                }}
              >
                <Input
                  aria-label={t`App slug`}
                  value={draft}
                  maxLength={80}
                  placeholder="gmail"
                  disabled={!restrictApps}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button type="submit" variant="outline" disabled={!restrictApps || !draft.trim()}>
                  <Trans>Add</Trans>
                </Button>
              </form>
            }
          />
          {allowedApps.map((app) => (
            <SettingsRow
              key={app}
              label={app}
              control={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!restrictApps}
                  aria-label={t`Remove ${app}`}
                  onClick={() => setAllowedApps(allowedApps.filter((item) => item !== app))}
                >
                  <X />
                </Button>
              }
            />
          ))}
        </SettingsGroup>
      </div>

      <div>
        <Button onClick={() => void save()} disabled={!changed || busy}>
          {busy ? <Spinner /> : null}
          <Trans>Save</Trans>
        </Button>
      </div>
    </div>
  );
}
