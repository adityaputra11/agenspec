import { useLingui } from "@lingui/react/macro";
import { Badge } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceQueries } from "../../lib/query";

export function MembersPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const members = useQuery(queries.cms.members.list.queryOptions());
  const roleLabels: Record<string, string> = {
    owner: t`Owner`,
    admin: t`Admin`,
    member: t`Member`,
  };

  return (
    <SettingsGroup>
      {(members.data ?? []).map((member) => (
        <SettingsRow
          key={member.userId}
          label={
            <div className="min-w-0">
              <div className="truncate">{member.name}</div>
              <div className="truncate text-[12.5px] text-muted-foreground">{member.email}</div>
            </div>
          }
          control={
            <Badge variant="outline">
              {member.role
                .split(",")
                .map((part) => roleLabels[part.trim()] ?? part.trim())
                .join(", ")}
            </Badge>
          }
        />
      ))}
    </SettingsGroup>
  );
}
