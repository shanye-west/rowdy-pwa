/**
 * Layout route for everything under /admin.
 *
 * Holds the one admin-wide gate (RequireAdmin) and the persistent section nav,
 * so any admin page is one tap from Players/Courses/Tools instead of a trip
 * back through the dashboard.
 */

import { Link, Outlet, useLocation } from "react-router-dom";
import { LayoutGrid, Users, Flag, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import RequireAdmin from "../../components/RequireAdmin";
import { cn } from "../../lib/utils";

interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra prefixes that should keep this tab lit (tournament pages live under Overview). */
  matches: (pathname: string) => boolean;
}

const NAV: AdminNavItem[] = [
  { to: "/admin/devices", label: "Devices", icon: Users, matches: (p) => p.startsWith("/admin/devices") },
  {
    to: "/admin",
    label: "Overview",
    icon: LayoutGrid,
    matches: (p) => p === "/admin" || p.startsWith("/admin/t/"),
  },
  { to: "/admin/players", label: "Players", icon: Users, matches: (p) => p.startsWith("/admin/players") },
  { to: "/admin/courses", label: "Courses", icon: Flag, matches: (p) => p.startsWith("/admin/courses") },
  { to: "/admin/recalculate", label: "Tools", icon: Wrench, matches: (p) => p.startsWith("/admin/recalculate") },
];

export default function AdminLayout() {
  const { pathname } = useLocation();

  return (
    <RequireAdmin>
      <nav
        aria-label="Admin sections"
        className="sticky z-40 border-b border-border/70 bg-background/95 backdrop-blur"
        style={{ top: "calc(var(--header-height) + env(safe-area-inset-top, 0px))" }}
      >
        <div className="flex gap-1 overflow-x-auto px-3 py-2">
          {NAV.map(({ to, label, icon: Icon, matches }) => {
            const active = matches(pathname);
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wider transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      <Outlet />
    </RequireAdmin>
  );
}
