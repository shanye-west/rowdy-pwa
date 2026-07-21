import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import "./firebase";
import { lazyWithRecovery } from "./utils/lazyWithRecovery";
import { AuthProvider } from "./contexts/AuthContext";
import { TournamentProvider } from "./contexts/TournamentContext";
import { LayoutProvider } from "./contexts/LayoutContext";
import { ToastProvider } from "./contexts/ToastContext";
import { NotificationsProvider } from "./contexts/NotificationsContext";
import App from "./App";
import ErrorBoundary, { NotFound } from "./components/ErrorBoundary";
import { LayoutShell } from "./components/Layout";
import RequireAdmin from "./components/RequireAdmin";

// Lazy load routes for code splitting - reduces initial bundle size
const Match = lazyWithRecovery(() => import("./routes/Match"));
const Round = lazyWithRecovery(() => import("./routes/Round"));
const Pairings = lazyWithRecovery(() => import("./routes/Pairings"));
const PairingsTV = lazyWithRecovery(() => import("./routes/PairingsTV"));
const Skins = lazyWithRecovery(() => import("./routes/Skins"));
const RoundRecap = lazyWithRecovery(() => import("./routes/RoundRecap"));
const Teams = lazyWithRecovery(() => import("./routes/Teams"));
const DraftPool = lazyWithRecovery(() => import("./routes/DraftPool"));
const Leaderboard = lazyWithRecovery(() => import("./routes/Leaderboard"));
const Sportsbook = lazyWithRecovery(() => import("./routes/Sportsbook"));
const Chat = lazyWithRecovery(() => import("./routes/Chat"));
const Player = lazyWithRecovery(() => import("./routes/Player"));
const Login = lazyWithRecovery(() => import("./routes/Login"));
const History = lazyWithRecovery(() => import("./routes/History"));
const NotificationSettings = lazyWithRecovery(() => import("./routes/NotificationSettings"));
const RulesOfficial = lazyWithRecovery(() => import("./routes/RulesOfficial"));
const Tournament = lazyWithRecovery(() => import("./routes/Tournament"));
const AdminDashboard = lazyWithRecovery(() => import("./routes/admin/AdminDashboard"));
const AdminTournamentLayout = lazyWithRecovery(() => import("./routes/admin/AdminTournamentLayout"));
const TournamentHome = lazyWithRecovery(() => import("./routes/admin/TournamentHome"));
const TournamentSettings = lazyWithRecovery(() => import("./routes/admin/TournamentSettings"));
const RoundAdmin = lazyWithRecovery(() => import("./routes/admin/RoundAdmin"));
const MatchCreate = lazyWithRecovery(() => import("./routes/admin/MatchCreate"));
const MatchAdmin = lazyWithRecovery(() => import("./routes/admin/MatchAdmin"));
const PlayersAdmin = lazyWithRecovery(() => import("./routes/admin/PlayersAdmin"));
const CoursesAdmin = lazyWithRecovery(() => import("./routes/admin/CoursesAdmin"));
const CourseEdit = lazyWithRecovery(() => import("./routes/admin/CourseEdit"));
const RecalculateTournamentStats = lazyWithRecovery(() => import("./routes/RecalculateTournamentStats"));

// No loading fallback - CSS View Transitions handle page navigation smoothly
const router = createBrowserRouter(
  [
    // Full-bleed, view-only pairings "broadcast" board for screen-sharing on a
    // call. Intentionally sits OUTSIDE the LayoutShell (no header / bottom nav)
    // and is not linked anywhere in the UI — you type the URL directly.
    // `/pairings-tv` auto-detects the round; `/pairings-tv/2` pins round 2.
    { path: "/pairings-tv", element: <PairingsTV /> },
    { path: "/pairings-tv/:roundNum", element: <PairingsTV /> },
    {
      path: "/",
      element: <LayoutShell />,
      errorElement: (
        <LayoutShell>
          <ErrorBoundary />
        </LayoutShell>
      ),
      children: [
        { index: true, element: <App /> },
        { path: "round/:roundId", element: <Round /> },
        { path: "round/:roundId/pairings", element: <Pairings /> },
        { path: "round/:roundId/skins", element: <Skins /> },
        { path: "round/:roundId/recap", element: <RoundRecap /> },
        { path: "match/:matchId", element: <Match /> },
        { path: "teams", element: <Teams /> },
        { path: "draft", element: <DraftPool /> },
        { path: "leaderboard", element: <Leaderboard /> },
        { path: "sportsbook", element: <Sportsbook /> },
        { path: "chat", element: <Chat /> },
        { path: "player/:playerId", element: <Player /> },
        { path: "history", element: <History /> },
        { path: "rules-official", element: <RulesOfficial /> },
        { path: "settings/notifications", element: <NotificationSettings /> },
        { path: "tournament/:tournamentId", element: <Tournament /> },
        { path: "login", element: <Login /> },
        { path: "admin", element: <RequireAdmin><AdminDashboard /></RequireAdmin> },
        {
          path: "admin/t/:tournamentId",
          element: <RequireAdmin><AdminTournamentLayout /></RequireAdmin>,
          children: [
            { index: true, element: <TournamentHome /> },
            { path: "settings", element: <TournamentSettings /> },
            { path: "round/:roundId", element: <RoundAdmin /> },
            { path: "round/:roundId/match/new", element: <MatchCreate /> },
            { path: "match/:matchId", element: <MatchAdmin /> },
          ],
        },
        { path: "admin/players", element: <RequireAdmin><PlayersAdmin /></RequireAdmin> },
        { path: "admin/courses", element: <RequireAdmin><CoursesAdmin /></RequireAdmin> },
        { path: "admin/courses/:courseId", element: <RequireAdmin><CourseEdit /></RequireAdmin> },
        { path: "admin/recalculate", element: <RequireAdmin><RecalculateTournamentStats /></RequireAdmin> },
        // Legacy task-page URLs from the pre-entity-centric admin
        { path: "admin/match", element: <Navigate to="/admin" replace /> },
        { path: "admin/match/edit", element: <Navigate to="/admin" replace /> },
        { path: "admin/match/recalculate", element: <Navigate to="/admin" replace /> },
        { path: "admin/match/controls", element: <Navigate to="/admin" replace /> },
        { path: "admin/round/recap", element: <Navigate to="/admin" replace /> },
        { path: "admin/rounds", element: <Navigate to="/admin" replace /> },
        { path: "admin/tournament", element: <Navigate to="/admin" replace /> },
        { path: "admin/tournament/recalculate", element: <Navigate to="/admin/recalculate" replace /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  {
    future: {
      v7_skipActionErrorRevalidation: true,
    },
  }
);

// Register the service worker once, app-wide (previously this only ran on the
// Home route, so a user sitting on a sub-page never checked for new versions).
// In autoUpdate mode the SW reloads the page itself once a new version
// activates; the 60s poll forces a timely update check regardless of route.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      // Don't pull a new version (which, in autoUpdate mode, reloads the page)
      // while the user is actively on a match scorecard — a reload mid-entry
      // risks losing an in-flight keystroke. The update is picked up as soon as
      // they leave the scorecard; stale-chunk recovery covers that navigation.
      const onScorecard = () => location.pathname.startsWith("/match/");
      const maybeUpdate = () => {
        if (onScorecard()) return;
        registration.update().catch(() => {});
      };
      setInterval(maybeUpdate, 60_000);
      // iOS home-screen PWAs spend most of their life backgrounded; check for a
      // new version the moment the app is brought back to the foreground, so a
      // deploy is picked up on resume instead of waiting out the 60s poll (which
      // shrinks the window where a navigation can hit a now-stale chunk).
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          maybeUpdate();
        }
      });
    }
  },
});

// Recover from a stale-chunk load failure. After a deploy, a client still
// running the old bundle can request a lazy-route chunk that no longer exists
// (404) before the new SW has taken over — Vite fires `vite:preloadError`.
// Reload once to pick up the fresh bundle; the timestamp guard prevents an
// infinite reload loop if the reload also fails (the ErrorBoundary then escalates).
window.addEventListener("vite:preloadError", () => {
  const KEY = "preload-error-reloaded-at";
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 10_000) return; // already tried very recently — don't loop
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
});

// Ask the browser to exempt this origin's storage from eviction under storage
// pressure. Everything offline scoring depends on lives in IndexedDB —
// Firestore's cache AND its queue of unsent score writes, plus the auth
// session — and iOS can silently evict all of it from an idle app, losing
// queued scores. Best-effort: browsers may decline (the pre-round readiness
// check re-requests from a user gesture, which improves grant odds).
if (typeof navigator !== "undefined" && navigator.storage?.persist) {
  void navigator.storage.persist().catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <TournamentProvider>
        <LayoutProvider>
          <ToastProvider>
            <NotificationsProvider>
              <RouterProvider router={router} />
            </NotificationsProvider>
          </ToastProvider>
        </LayoutProvider>
      </TournamentProvider>
    </AuthProvider>
  </React.StrictMode>
);
