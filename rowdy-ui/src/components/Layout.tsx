import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useMatches, Outlet } from "react-router-dom";
import {
  ChevronLeft,
  Menu,
  X,
  Shield,
  Trophy,
  History,
  ClipboardList,
  LogOut,
  LogIn,
  Wifi,
  Bell,
  Download,
  Settings,
  Loader2,
} from "lucide-react";
import PullToRefresh from "./PullToRefresh";
import LoadingScreen from "./LoadingScreen";
import BottomNav from "./BottomNav";
import OfflineImage from "./OfflineImage";
import { ConnectionBanner } from "./ConnectionBanner";
import { Modal, ModalActions } from "./Modal";
import { ViewTransitionLink } from "./ViewTransitionLink";
import { NotificationBell } from "./NotificationBell";
import { useAuth } from "../contexts/AuthContext";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { InstallGuideModal } from "./InstallGuideModal";
import { isIOS, isStandalone } from "../messaging";
import { useTournamentContextOptional } from "../contexts/TournamentContext";
import { useOnlineStatusWithHistory } from "../hooks/useOnlineStatus";
import { useLayout } from "../contexts/LayoutContext";
import { useViewTransitionDirection, startViewTransitionSafe } from "../hooks/useViewTransition";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type LayoutProps = {
  title: string;
  series?: string; // "rowdyCup" | "christmasClassic"
  showBack?: boolean;
  tournamentLogo?: string;
  children: React.ReactNode;
};

type LayoutShellProps = {
  children?: React.ReactNode;
};

export function LayoutShell({ children }: LayoutShellProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const { player, logout, loading: authLoading } = useAuth();
  const { pushOn, busy: pushBusy, pushUnsupported, toggle: togglePush } = usePushNotifications();
  const { canInstall, guideOpen, openGuide, closeGuide } = useInstallPrompt();
  // Offer "Install app" whenever the app isn't already installed and we can either
  // fire the native prompt (Android/Chromium) or walk an iPhone user through it.
  const showInstall = !isStandalone() && (canInstall || isIOS());
  const tournamentCtx = useTournamentContextOptional();
  const draftPoolCount = tournamentCtx?.tournament?.draftPool
    ? Object.keys(tournamentCtx.tournament.draftPool).length
    : 0;
  const showDraftPool = draftPoolCount > 0 && !tournamentCtx?.tournament?.hideDraftPool;
  const { isOnline, wasOffline } = useOnlineStatusWithHistory();
  const { config } = useLayout();
  const { title, series, showBack, tournamentLogo } = config;
  const location = useLocation();
  // Key the route Suspense by the matched leaf route (NOT the full pathname), so
  // it remounts when switching to a different route template — forcing a fresh
  // boundary that DOES show its fallback while the lazy chunk loads (an already-
  // mounted boundary is suppressed during a navigation transition, which is why
  // a slow/hanging route used to look frozen). Param-only changes (e.g.
  // /match/a → /match/b) keep the same key, so they don't remount or flash.
  const matches = useMatches();
  const routeKey = matches[matches.length - 1]?.id ?? location.pathname;

  // Track navigation direction for CSS View Transitions
  useViewTransitionDirection();
  // PUSH → top, POP → restore previous scroll position.
  useScrollRestoration();

  // Handle back navigation with view transition. startViewTransitionSafe runs
  // navigate() even when the API is unsupported or throws, so going back can
  // never be swallowed by the animation layer.
  const handleBack = () => {
    startViewTransitionSafe(() => navigate(-1));
  };

  // Turn web push on/off for this device (toast feedback + iOS guidance handled
  // by the shared hook).
  const handleTogglePush = () => {
    setMenuOpen(false);
    void togglePush();
  };

  // Open the add-to-Home-Screen guide / native install prompt.
  const handleInstall = () => {
    setMenuOpen(false);
    openGuide();
  };

  // Logout, gated behind a confirm dialog to prevent accidental taps.
  const performLogout = async () => {
    setConfirmLogout(false);
    await logout();
    setShowLogoutConfirm(true);
    setTimeout(() => setShowLogoutConfirm(false), 3000);
    navigate("/");
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
    const isChristmas = series === "christmasClassic";
    document.body.classList.toggle("theme-christmas", isChristmas);
    // Keep the live status-bar / toolbar tint in sync with the active theme.
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", isChristmas ? "#ef211c" : "#132448");
  }, [series]);

  // Close menu when tapping outside it (tapping the bell counts as outside, so
  // it closes the menu too). We listen on pointerdown rather than click because
  // the toggle button swaps its icon (Menu ↔ X) on open: a click landing on the
  // center icon would re-render and detach that node before the click bubbles
  // here, making a contains() check on the click target spuriously read as
  // "outside". pointerdown fires before that swap and only after the opening
  // tap, so the menu opens reliably and still closes on any genuine outside tap.
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  // Hide the bottom tab bar on admin/login routes (they have their own navigation context).
  const hideBottomNav =
    location.pathname.startsWith("/admin") || location.pathname === "/login";
  const closeMenu = () => setMenuOpen(false);
  
  // Simple page content - CSS View Transitions handle the animation
  const pageContent = children ?? <Outlet />;

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

        {/* Right: Notification bell + Hamburger Menu */}
        <div className="flex items-center justify-end gap-0.5">
          <NotificationBell />
          <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMenuOpen(!menuOpen)}
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
              <Card className="border border-border/60 bg-card/95 shadow-2xl backdrop-blur">
                  {!authLoading && player && (
                    <div className="px-4 py-3">
                      <div className="text-sm font-semibold text-foreground">
                        {player.displayName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {player.email || "Logged in"}
                      </div>
                      {player.isAdmin && (
                        <div className="mt-2 inline-flex rounded-full bg-primary px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-primary-foreground">
                          Admin
                        </div>
                      )}
                    </div>
                  )}

                  {!authLoading && player && <div className="h-px bg-border/80" />}

                  <div className="space-y-1 p-2">
                    {showDraftPool && (
                      <Button asChild variant="ghost" className="w-full justify-start gap-2 text-foreground hover:bg-muted">
                        <ViewTransitionLink to="/draft" onClick={closeMenu}>
                          <ClipboardList className="h-4 w-4 text-muted-foreground" />
                          Draft Pool
                        </ViewTransitionLink>
                      </Button>
                    )}

                    <Button asChild variant="ghost" className="w-full justify-start gap-2 text-foreground hover:bg-muted">
                      <ViewTransitionLink to="/leaderboard" onClick={closeMenu}>
                        <Trophy className="h-4 w-4 text-muted-foreground" />
                        Player Leaderboard
                      </ViewTransitionLink>
                    </Button>

                    <Button asChild variant="ghost" className="w-full justify-start gap-2 text-foreground hover:bg-muted">
                      <ViewTransitionLink to="/history" onClick={closeMenu}>
                        <History className="h-4 w-4 text-muted-foreground" />
                        History
                      </ViewTransitionLink>
                    </Button>

                    {showInstall && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full justify-start gap-2 text-foreground hover:bg-muted"
                        onClick={handleInstall}
                      >
                        <Download className="h-4 w-4 text-muted-foreground" />
                        Install app
                      </Button>
                    )}

                    {player && !pushUnsupported && !pushOn && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full justify-start gap-2 text-foreground hover:bg-muted"
                        onClick={handleTogglePush}
                        disabled={pushBusy}
                      >
                        {pushBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Bell className="h-4 w-4 text-muted-foreground" />
                        )}
                        {pushBusy ? "Working…" : "Enable notifications"}
                      </Button>
                    )}

                    {player && pushOn && (
                      <Button asChild variant="ghost" className="w-full justify-start gap-2 text-foreground hover:bg-muted">
                        <ViewTransitionLink to="/settings/notifications" onClick={closeMenu}>
                          <Settings className="h-4 w-4 text-muted-foreground" />
                          Notification settings
                        </ViewTransitionLink>
                      </Button>
                    )}

                    {player?.isAdmin && (
                      <Button asChild variant="ghost" className="w-full justify-start gap-2 text-foreground hover:bg-muted">
                        <ViewTransitionLink to="/admin" onClick={closeMenu}>
                          <Shield className="h-4 w-4 text-muted-foreground" />
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
                            onClick={() => {
                              closeMenu();
                              setConfirmLogout(true);
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
        </div>
      </header>

      {/* WRAP CONTENT IN PULL-TO-REFRESH. Data is already live via Firestore
          listeners, so the honest refresh action is an app-update check — with
          autoUpdate, finding a new version reloads the page on its own. */}
      <PullToRefresh
        onRefresh={async () => {
          try {
            const regs = await navigator.serviceWorker?.getRegistrations?.();
            await Promise.all((regs ?? []).map((r) => r.update().catch(() => {})));
          } catch {
            /* no SW (dev/unsupported browser) — the gesture still resolves */
          }
        }}
      >
        {/* Offline Status Banner — app-wide so every route signals offline state */}
        <ConnectionBanner isOnline={isOnline} />

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

        <main className={`app-container${hideBottomNav ? "" : " has-bottom-nav"}`}>
          {/* Routes are React.lazy. On a hard reload onto a lazy route there's no
              prior UI, so without a boundary the user sees a blank screen while
              the chunk downloads — this shows the spinner instead. On client
              navigation React Router runs in a transition, so the old page stays
              and this fallback does not flash (smooth View Transitions preserved). */}
          <Suspense key={routeKey} fallback={<LoadingScreen />}>
            {pageContent}
          </Suspense>
        </main>
      </PullToRefresh>

      {!hideBottomNav && <BottomNav />}

      <InstallGuideModal isOpen={guideOpen} onClose={closeGuide} />

      <Modal
        isOpen={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Log out?"
        ariaLabel="Confirm logout"
      >
        <p className="mb-4 text-center text-sm text-muted-foreground">
          You'll need to log back in to enter scores.
        </p>
        <ModalActions
          primaryLabel="Log Out"
          primaryClass="bg-red-600 hover:bg-red-700"
          onPrimary={performLogout}
          secondaryLabel="Cancel"
          onSecondary={() => setConfirmLogout(false)}
        />
      </Modal>
    </>
  );
}

export default function Layout({ title, series, showBack, tournamentLogo, children }: LayoutProps) {
  const { config, setConfig } = useLayout();

  useLayoutEffect(() => {
    if (title === "Loading...") {
      setConfig({
        title: config.title,
        series: config.series,
        tournamentLogo: config.tournamentLogo,
        showBack: showBack ?? config.showBack,
      });
      return;
    }
    setConfig({ title, series, showBack, tournamentLogo });
  }, [title, series, showBack, tournamentLogo, setConfig, config]);

  return <>{children}</>;
}
