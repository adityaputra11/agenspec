import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceQueries } from "../../lib/query";
import { formatDate, providerLabel } from "./shared";

export function OverviewPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const documents = useQuery(queries.cms.documents.list.queryOptions());
  const policy = useQuery(queries.cms.policy.get.queryOptions());
  const members = useQuery(queries.cms.members.list.queryOptions());
  const model = useQuery(queries.cms.models.get.queryOptions());
  const catalog = useQuery(queries.models.list.queryOptions());
  const recent = [...(documents.data ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  const appsValue = policy.data?.restrictApps
    ? t`${policy.data.allowedApps.length} allowed`
    : t`All apps`;
  const modelValue =
    model.data?.connected && model.data.provider
      ? `${providerLabel(catalog.data ?? [], model.data.provider)} · ${model.data.modelId ?? ""}`
      : t`Not set`;
  const value = (text: string | number) => (
    <span className="text-[14px] text-muted-foreground">{text}</span>
  );

  return (
    <>
      <SettingsGroup>
        <SettingsRow
          label={<Trans>Documents</Trans>}
          control={value(documents.data?.length ?? 0)}
        />
        <SettingsRow label={<Trans>Apps</Trans>} control={value(appsValue)} />
        <SettingsRow label={<Trans>Model</Trans>} control={value(modelValue)} />
        <SettingsRow label={<Trans>Members</Trans>} control={value(members.data?.length ?? 0)} />
      </SettingsGroup>
      {recent.length > 0 ? (
        <SettingsGroup title={<Trans>Recent documents</Trans>}>
          {recent.map((document) => (
            <SettingsRow
              key={document.id}
              label={<span className="block truncate">{document.name}</span>}
              control={value(formatDate(document.createdAt))}
            />
          ))}
        </SettingsGroup>
      ) : null}
    </>
  );
}
