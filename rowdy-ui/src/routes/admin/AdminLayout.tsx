/**
 * Layout route for everything under /admin.
 *
 * Holds the one admin-wide gate (RequireAdmin) and the persistent section nav,
 * so any admin page is one tap from Players/Courses/Tools instead of a trip
 * back through the dashboard.
 */

import { Link, Outlet, useLocation } from "react-router-dom";
import { Flag, LayoutGrid, Smartphone, Users, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import RequireAdmin from "../../components/RequireAdmin";
import { cn } from "../../lib/utils";

interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Which paths keep this tab lit (tournament pages live under Overview). */
  matches: (pathname: string) => boolean;
}

// Ordered by how often each is used: the tournament work first, then the two
// shared libraries, then diagnostics and maintenance.
const NAV: AdminNavItem[] = [
  {
    to: "/admin",
    label: "Overview",
    icon: LayoutGrid,
    matches: (p) => p === "/admin" || p === "/admin/" || p.startsWith("/admin/t/"),
  },
  { to: "/admin/players", label: "Players", icon: Users, matches: (p) => p.startsWith("/admin/players") },
  { to: "/admin/courses", label: "Courses", icon: Flag, matches: (p) => p.startsWith("/admin/courses") },
  { to: "/admin/devices", label: "Devices", icon: Smartphone, matches: (p) => p.startsWith("/admin/devices") },
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
        {/* Equal-width tabs: all five fit a phone with no sideways scroll. */}
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {NAV.map(({ to, label, icon: Icon, matches }) => {
            const active = matches(pathname);
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wide transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
                {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" aria-hidden="true" />}
              </Link>
            );
          })}
        </div>
      </nav>

      <Outlet />
    </RequireAdmin>
  );
}
