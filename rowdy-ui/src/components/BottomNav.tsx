import { useLocation } from "react-router-dom";
import { Home, Users, History, DollarSign } from "lucide-react";
import { ViewTransitionLink } from "./ViewTransitionLink";

type Tab = {
  to: string;
  label: string;
  Icon: typeof Home;
  /** Returns true when this tab should be highlighted for the given pathname. */
  isActive: (pathname: string) => boolean;
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

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map(({ to, label, Icon, isActive }) => {
        const active = isActive(pathname);
        return (
          <ViewTransitionLink
            key={to}
            to={to}
            className="bottom-nav-item"
            aria-current={active ? "page" : undefined}
            aria-label={label}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
            <span>{label}</span>
          </ViewTransitionLink>
        );
      })}
    </nav>
  );
}
