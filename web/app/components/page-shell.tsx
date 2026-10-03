import Link from "next/link";
import type { ReactNode } from "react";
import { BackLink } from "./back-link";
import { Icon } from "./icons";

type PrimaryPage = "select" | "library" | "records";

const tabs = [
  { id: "select", label: "选句", href: "/", icon: "search" },
  { id: "library", label: "句子库", href: "/library", icon: "book" },
  { id: "records", label: "记录", href: "/records", icon: "history" },
] as const;

export function PageShell({
  title,
  children,
  primary,
  backHref,
  extra,
  action,
}: {
  title: string;
  children: ReactNode;
  primary?: PrimaryPage;
  backHref?: string;
  extra?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`app-frame ${action ? "has-action" : ""} ${primary ? "has-tabs" : ""}`}>
      <div className="reading-column">
        {primary && (
          <nav className="desktop-nav" aria-label="主导航">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href} aria-current={primary === tab.id ? "page" : undefined}>
                {tab.label}
              </Link>
            ))}
          </nav>
        )}
        <header className="page-header">
          {backHref && <BackLink fallback={backHref} />}
          <h1>{title}</h1>
          <div className="header-actions">
            {extra}
            {primary && (
              <Link href={`/settings?from=${tabs.find((tab) => tab.id === primary)?.href}`} className="icon-link" aria-label="设置">
                <Icon name="settings" />
              </Link>
            )}
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
      {action && <div className="bottom-action"><div className="reading-column">{action}</div></div>}
      {primary && (
        <nav className="mobile-tabs" aria-label="主导航">
          {tabs.map((tab) => (
            <Link key={tab.id} href={tab.href} aria-current={primary === tab.id ? "page" : undefined}>
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="section-heading">{children}</h2>;
}

export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="empty-text">{children}</p>;
}
