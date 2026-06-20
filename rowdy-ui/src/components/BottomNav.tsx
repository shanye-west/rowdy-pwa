import { useLocation } from "react-router-dom";
import { Home, Users, History, DollarSign } from "lucide-react";
import { ViewTransitionLink } from "./ViewTransitionLink";
import { useNotifications } from "../contexts/NotificationsContext";

type Tab = {
  to: string;
  label: string;
  Icon: typeof Home;
  /** Returns true when this tab should be highlighted for the given pathname. */
  isActive: (pathname: string) => boolean;
  /** Deep-link prefix whose unread notifications badge this tab (optional). */
  badgePrefix?: string;
};

const TABS: Tab[] = [
  {
    to: "/",
    label: "Home",
    Icon: Home,
    // The live tournament "stack" — schedule, rounds, and matches all hang off Home.
    isActive: (p) => p === "/" || p.startsWith("/round") || p.startsWith("/match"),
  },
  {
    to: "/teams",
    label: "Teams",
    Icon: Users,
    isActive: (p) => p.startsWith("/teams"),
  },
  {
    to: "/sportsbook",
    label: "Bets",
    Icon: DollarSign,
    isActive: (p) => p.startsWith("/sportsbook"),
    // Badge bet challenges/accepts + sportsbook-feed chat (all link to /sportsbook).
    badgePrefix: "/sportsbook",
  },
  {
    to: "/history",
    label: "History",
    Icon: History,
    // Past-tournament detail pages are reached from History.
    isActive: (p) => p.startsWith("/history") || p.startsWith("/tournament"),
  },
];

/**
 * Persistent, thumb-reachable bottom tab bar for the primary public destinations.
 * Rendered by LayoutShell and hidden on admin/login routes.
 */
export default function BottomNav() {
  const { pathname } = useLocation();
  const { unreadForPrefix } = useNotifications();

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map(({ to, label, Icon, isActive, badgePrefix }) => {
        const active = isActive(pathname);
        const badge = badgePrefix ? unreadForPrefix(badgePrefix) : 0;
        return (
          <ViewTransitionLink
            key={to}
            to={to}
            className="bottom-nav-item"
            aria-current={active ? "page" : undefined}
            aria-label={badge > 0 ? `${label}, ${badge} unread` : label}
          >
            <span className="relative">
              <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              {badge > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[0.6rem] font-bold leading-none text-white">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            <span>{label}</span>
          </ViewTransitionLink>
        );
      })}
    </nav>
  );
}
