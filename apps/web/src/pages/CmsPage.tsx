import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Blocks, ChevronLeft, FileText, LayoutDashboard, Users } from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { SETTINGS_CONTENT_WIDTH } from "../components/SettingsRows";
import { useSpaceQueries } from "../lib/query";
import { AppsPage } from "./cms/apps-page";
import { DocumentsPage } from "./cms/documents-page";
import { MembersPage } from "./cms/members-page";
import { OverviewPage } from "./cms/overview-page";
import { settingsNavItemClass } from "./settings-nav";
import { WindowChrome } from "./WindowChrome";

export function CmsPage() {
  const status = useQuery(useSpaceQueries().cms.status.queryOptions());
  if (status.isPending) return <PageLoading />;
  if (!status.data?.isOrgAdmin) return <Navigate to="/app" replace />;
  return <CmsConsole organizationName={status.data.organizationName ?? ""} />;
}

function CmsConsole({ organizationName }: { organizationName: string }) {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const items = [
    { to: "/cms", label: t`Overview`, icon: LayoutDashboard },
    { to: "/cms/documents", label: t`Documents`, icon: FileText },
    { to: "/cms/apps", label: t`Apps`, icon: Blocks },
    { to: "/cms/members", label: t`Members`, icon: Users },
  ];
  const isActive = (to: string) =>
    to === "/cms" ? pathname === "/cms" || pathname === "/cms/" : pathname.startsWith(to);
  const title = items.find((item) => isActive(item.to))?.label ?? t`Admin`;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <WindowChrome />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label={t`Admin`}
          className="flex min-w-0 flex-row gap-1 overflow-x-auto border-b border-border px-3 py-3 md:w-[200px] md:shrink-0 md:flex-col md:overflow-y-auto md:border-b-0 md:border-e md:bg-sidebar md:py-4"
        >
          <Link to="/app" aria-label={t`Back`} className={settingsNavItemClass(false)}>
            <ChevronLeft className="size-4 shrink-0 rtl:rotate-180" strokeWidth={1.75} />
            <span className="hidden whitespace-nowrap md:inline">
              <Trans>Back to app</Trans>
            </span>
          </Link>
          <div className="hidden truncate px-2.5 pb-2 pt-1 text-[13px] text-muted-foreground md:block">
            {organizationName}
          </div>
          {items.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={settingsNavItemClass(active)}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 pb-5 pt-6 sm:px-8 sm:pt-7">
            <h1 className="min-w-0 break-words text-heading2 font-medium text-foreground">
              {title}
            </h1>
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
            <div className={`${SETTINGS_CONTENT_WIDTH} space-y-8`}>
              <Routes>
                <Route index element={<OverviewPage />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="apps" element={<AppsPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="*" element={<Navigate to="/cms" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
