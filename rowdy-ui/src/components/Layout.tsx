import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavigate, useLocation, matchPath, Outlet } from "react-router-dom";
import {
  ChevronLeft,
  Menu,
  X,
  Home,
  Users,
  History,
  Shield,
  LogOut,
  LogIn,
  Wifi,
} from "lucide-react";
import PullToRefresh from "./PullToRefresh";
import OfflineImage from "./OfflineImage";
import { ViewTransitionLink } from "./ViewTransitionLink";
import { useAuth } from "../contexts/AuthContext";
import { useOnlineStatusWithHistory } from "../hooks/useOnlineStatus";
import { useLayout } from "../contexts/LayoutContext";
import { useViewTransitionDirection, supportsViewTransitions } from "../hooks/useViewTransition";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type LayoutProps = {
  title: string;
  series?: string; // "rowdyCup" | "christmasClassic"
  showBack?: boolean;
  tournamentLogo?: string;
  isLoading?: boolean;
  children: React.ReactNode;
};

type LayoutShellProps = {
  children?: React.ReactNode;
};

export function LayoutShell({ children }: LayoutShellProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { player, logout, loading: authLoading } = useAuth();
  const { isOnline, wasOffline } = useOnlineStatusWithHistory();
  const { config } = useLayout();
  const { title, series, showBack, tournamentLogo, isLoading } = config;
  const location = useLocation();
  
  // Track navigation direction for CSS View Transitions
  useViewTransitionDirection();

  // Set loading state on document for CSS transitions
  useEffect(() => {
    if (isLoading) {
      document.documentElement.dataset.pageLoading = "true";
    } else {
      delete document.documentElement.dataset.pageLoading;
    }
  }, [isLoading]);

  // Handle back navigation with view transition
  const handleBack = () => {
    if (supportsViewTransitions() && (document as any).startViewTransition) {
      (document as any).startViewTransition(() => {
        navigate(-1);
      });
    } else {
      navigate(-1);
    }
  };

  // Parse title to extract year (if present at start) and main name
  const { year, mainTitle } = useMemo(() => {
    const match = title.match(/^(\d{4})\s+(.+)$/);
    if (match) {
      return { year: match[1], mainTitle: match[2] };
    }
    return { year: null, mainTitle: title };
  }, [title]);

  // --- THEME ENGINE ---
  useEffect(() => {
    if (series === "christmasClassic") {
      document.body.classList.add("theme-christmas");
    } else {
      document.body.classList.remove("theme-christmas");
    }
  }, [series]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = () => setMenuOpen(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [menuOpen]);

  // Compute dynamic Team Rosters link: if current route is a specific tournament,
  // point the Team Rosters menu entry at that tournament's rosters.
  const tournamentMatch = matchPath({ path: "/tournament/:tournamentId" }, location.pathname);
  const teamLink = tournamentMatch && (tournamentMatch.params as any)?.tournamentId
    ? `/teams?tournamentId=${encodeURIComponent((tournamentMatch.params as any).tournamentId)}`
    : "/teams";
  const closeMenu = () => setMenuOpen(false);
  
  // Simple page content - CSS View Transitions handle the animation
  const pageContent = children ?? <Outlet />;

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, left: 0 });
    } catch (error) {}
  }, [location.pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <>
      {/* STICKY HEADER */}
      <header className="app-header">
        {/* Left: Back Button (if shown) + Tournament Logo */}
        <div className="flex items-center gap-2">
          {showBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="text-white/90 hover:bg-white/10 hover:text-white"
              aria-label="Go Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <ViewTransitionLink to="/" aria-label="Home" className="flex items-center">
            <OfflineImage 
              src={tournamentLogo} 
              alt="Tournament Logo"
              fallbackIcon="⛳"
              fallbackSrc={
                series === "christmasClassic" 
                  ? "/images/rowdycup-logo-christmas.svg" 
                  : "/images/rowdycup-logo.svg"
              }
              style={{ height: 40, width: 40, objectFit: "contain" }} 
            />
          </ViewTransitionLink>
        </div>

        {/* Center: Tournament Title (year small on top, main title below) */}
        <div className="flex flex-1 flex-col items-center text-center leading-tight">
          {year && (
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-white/70">
              {year}
            </div>
          )}
          <div className="text-sm font-semibold uppercase tracking-[0.22em] text-white drop-shadow-sm sm:text-base">
            {mainTitle}
          </div>
        </div>

        {/* Right: Hamburger Menu */}
        <div className="relative flex min-w-[48px] items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="text-white/90 hover:bg-white/10 hover:text-white"
            aria-label="Menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          {menuOpen && (
            <div
              className="absolute right-0 top-[calc(100%+0.6rem)] w-64 origin-top-right animate-menu-open"
              onClick={(e) => e.stopPropagation()}
            >
              <Card className="border border-white/30 bg-white/95 shadow-2xl backdrop-blur">
                  {!authLoading && player && (
                    <div className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-900">
                        {player.displayName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {player.email || "Logged in"}
                      </div>
                      {player.isAdmin && (
                        <div className="mt-2 inline-flex rounded-full bg-slate-900 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white">
                          Admin
                        </div>
                      )}
                    </div>
                  )}

                  <div className="h-px bg-slate-200/80" />

                  <div className="space-y-1 p-2">
                    <Button asChild variant="ghost" className="w-full justify-start gap-2 text-slate-700 hover:bg-slate-100">
                      <ViewTransitionLink to="/" onClick={closeMenu}>
                        <Home className="h-4 w-4 text-slate-500" />
                        Home
                      </ViewTransitionLink>
                    </Button>
                    <Button asChild variant="ghost" className="w-full justify-start gap-2 text-slate-700 hover:bg-slate-100">
                      <ViewTransitionLink to={teamLink} onClick={closeMenu}>
                        <Users className="h-4 w-4 text-slate-500" />
                        Team Rosters
                      </ViewTransitionLink>
                    </Button>
                    <Button asChild variant="ghost" className="w-full justify-start gap-2 text-slate-700 hover:bg-slate-100">
                      <ViewTransitionLink to="/history" onClick={closeMenu}>
                        <History className="h-4 w-4 text-slate-500" />
                        History
                      </ViewTransitionLink>
                    </Button>

                    {player?.isAdmin && (
                      <Button asChild variant="ghost" className="w-full justify-start gap-2 text-slate-700 hover:bg-slate-100">
                        <ViewTransitionLink to="/admin" onClick={closeMenu}>
                          <Shield className="h-4 w-4 text-slate-500" />
                          Admin
                        </ViewTransitionLink>
                      </Button>
                    )}

                    {!authLoading && (
                      <>
                        {player ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="w-full justify-start gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={async () => {
                              closeMenu();
                              await logout();
                              setShowLogoutConfirm(true);
                              setTimeout(() => setShowLogoutConfirm(false), 3000);
                              navigate("/");
                            }}
                          >
                            <LogOut className="h-4 w-4" />
                            Logout
                          </Button>
                        ) : (
                          <Button asChild variant="ghost" className="w-full justify-start gap-2 text-blue-600 hover:bg-blue-50 hover:text-blue-700">
                            <ViewTransitionLink to="/login" onClick={closeMenu}>
                              <LogIn className="h-4 w-4" />
                              Login
                            </ViewTransitionLink>
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              </div>
            )}
        </div>
      </header>

      {/* WRAP CONTENT IN PULL-TO-REFRESH */}
      <PullToRefresh>
        {/* Offline Status Banner removed: Match route handles offline banner now */}
        
        {/* Back Online Banner (auto-dismisses after 3s) */}
        {wasOffline && isOnline && (
          <div className="flex items-center justify-center gap-2 bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white shadow-sm">
            <Wifi className="h-4 w-4" />
            <span>Back online — syncing changes</span>
          </div>
        )}

        {/* Logout Confirmation Banner (auto-dismisses after 3s) */}
        {showLogoutConfirm && (
          <div className="flex items-center justify-center gap-2 bg-blue-600/90 px-4 py-2 text-sm font-semibold text-white shadow-sm">
            <LogOut className="h-4 w-4" />
            <span>You've been logged out</span>
          </div>
        )}

        <main className="app-container">{pageContent}</main>
      </PullToRefresh>
    </>
  );
}

export default function Layout({ title, series, showBack, tournamentLogo, isLoading, children }: LayoutProps) {
  const { config, setConfig } = useLayout();

  useLayoutEffect(() => {
    if (title === "Loading...") {
      setConfig({
        title: config.title,
        series: config.series,
        tournamentLogo: config.tournamentLogo,
        showBack: showBack ?? config.showBack,
        isLoading: isLoading ?? true, // Treat "Loading..." title as loading state
      });
      return;
    }
    setConfig({ title, series, showBack, tournamentLogo, isLoading });
  }, [title, series, showBack, tournamentLogo, isLoading, setConfig, config]);

  return <>{children}</>;
}
