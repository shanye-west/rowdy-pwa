import React from "react";
import { markAppUpdateAvailable } from "./hooks/useAppUpdate";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import "./firebase";
import { recoverFromStaleChunk } from "./utils/swRecovery";
import { lazyWithRecovery } from "./utils/lazyWithRecovery";
import { AuthProvider } from "./contexts/AuthContext";
import { TournamentProvider } from "./contexts/TournamentContext";
import { LayoutProvider } from "./contexts/LayoutContext";
import { ToastProvider } from "./contexts/ToastContext";
import { NotificationsProvider } from "./contexts/NotificationsContext";
import App from "./App";
import ErrorBoundary, { NotFound } from "./components/ErrorBoundary";
import { LayoutShell } from "./components/Layout";
import RequireAuth from "./components/RequireAuth";

// Lazy load routes for code splitting - reduces initial bundle size
const Match = lazyWithRecovery(() => import("./routes/Match"));
const Round = lazyWithRecovery(() => import("./routes/Round"));
const Pairings = lazyWithRecovery(() => import("./routes/Pairings"));
const PairingPlan = lazyWithRecovery(() => import("./routes/PairingPlan"));
const PairingsTV = lazyWithRecovery(() => import("./routes/PairingsTV"));
const SideEvent = lazyWithRecovery(() => import("./routes/SideEvent"));
const SideEventScorecard = lazyWithRecovery(() => import("./routes/SideEventScorecard"));
const CaptainsMatchRound = lazyWithRecovery(() => import("./routes/CaptainsMatchRound"));
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
const AdminLayout = lazyWithRecovery(() => import("./routes/admin/AdminLayout"));
const AdminDashboard = lazyWithRecovery(() => import("./routes/admin/AdminDashboard"));
const AdminTournamentLayout = lazyWithRecovery(() => import("./routes/admin/AdminTournamentLayout"));
const TournamentHome = lazyWithRecovery(() => import("./routes/admin/TournamentHome"));
const TournamentSettings = lazyWithRecovery(() => import("./routes/admin/TournamentSettings"));
const RoundAdmin = lazyWithRecovery(() => import("./routes/admin/RoundAdmin"));
const SideEventAdmin = lazyWithRecovery(() => import("./routes/admin/SideEventAdmin"));
const CaptainsMatchAdmin = lazyWithRecovery(() => import("./routes/admin/CaptainsMatchAdmin"));
const CaptainsMatchRoundAdmin = lazyWithRecovery(() => import("./routes/admin/CaptainsMatchRoundAdmin"));
const MatchCreate = lazyWithRecovery(() => import("./routes/admin/MatchCreate"));
const MatchAdmin = lazyWithRecovery(() => import("./routes/admin/MatchAdmin"));
const DevicesAdmin = lazyWithRecovery(() => import("./routes/admin/DevicesAdmin"));
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
        // Captains' private planning board — usable before a draft exists, so
        // it's deliberately NOT gated on one (the page checks captaincy itself).
        { path: "round/:roundId/plan", element: <RequireAuth><PairingPlan /></RequireAuth> },
        { path: "round/:roundId/skins", element: <Skins /> },
        { path: "round/:roundId/recap", element: <RoundRecap /> },
        { path: "match/:matchId", element: <Match /> },
        // Side events — the optional, for-fun 9-hole games (3-man scramble).
        // Deliberately NOT under /round: they award no Cup points and are
        // reached only from the hamburger menu, never the tournament home page.
        { path: "side-event/:sideEventId", element: <SideEvent /> },
        { path: "side-event/:sideEventId/team/:teamId", element: <SideEventScorecard /> },
        // Captains' match — the pre-draft running singles match. Its round
        // cards hang off the tournament home page; not under /round, since it
        // awards no Cup points.
        { path: "captains-match/:tournamentId/round/:roundNumber", element: <CaptainsMatchRound /> },
        { path: "teams", element: <Teams /> },
        { path: "draft", element: <DraftPool /> },
        { path: "leaderboard", element: <Leaderboard /> },
        { path: "sportsbook", element: <RequireAuth><Sportsbook /></RequireAuth> },
        { path: "chat", element: <RequireAuth><Chat /></RequireAuth> },
        { path: "player/:playerId", element: <Player /> },
        { path: "history", element: <History /> },
        { path: "rules-official", element: <RulesOfficial /> },
        { path: "settings/notifications", element: <NotificationSettings /> },
        { path: "tournament/:tournamentId", element: <Tournament /> },
        { path: "login", element: <Login /> },
        // The whole admin surface shares one layout: a single RequireAdmin gate
        // plus the persistent section nav. URLs are unchanged.
        {
          path: "admin",
          element: <AdminLayout />,
          children: [
            { index: true, element: <AdminDashboard /> },
            {
              path: "t/:tournamentId",
              element: <AdminTournamentLayout />,
              children: [
                { index: true, element: <TournamentHome /> },
                { path: "settings", element: <TournamentSettings /> },
                { path: "round/:roundId", element: <RoundAdmin /> },
                { path: "round/:roundId/match/new", element: <MatchCreate /> },
                { path: "side-event/:sideEventId", element: <SideEventAdmin /> },
                { path: "captains-match", element: <CaptainsMatchAdmin /> },
                { path: "captains-match/round/:roundNumber", element: <CaptainsMatchRoundAdmin /> },
                { path: "match/:matchId", element: <MatchAdmin /> },
              ],
            },
            { path: "players", element: <PlayersAdmin /> },
            { path: "devices", element: <DevicesAdmin /> },
            { path: "courses", element: <CoursesAdmin /> },
            { path: "courses/:courseId", element: <CourseEdit /> },
            { path: "recalculate", element: <RecalculateTournamentStats /> },
            // Legacy task-page URLs from the pre-entity-centric admin
            { path: "match", element: <Navigate to="/admin" replace /> },
            { path: "match/edit", element: <Navigate to="/admin" replace /> },
            { path: "match/recalculate", element: <Navigate to="/admin" replace /> },
            { path: "match/controls", element: <Navigate to="/admin" replace /> },
            { path: "round/recap", element: <Navigate to="/admin" replace /> },
            { path: "rounds", element: <Navigate to="/admin" replace /> },
            { path: "tournament", element: <Navigate to="/admin" replace /> },
            { path: "tournament/recalculate", element: <Navigate to="/admin/recalculate" replace /> },
          ],
        },
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

// Updates activate automatically, but never force-refresh the user's page.
// Workbox can report external activations too; these must not cause reload loops.
registerSW({
  immediate: true,
  onNeedReload: markAppUpdateAvailable,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      // Defer explicit update checks while a scorecard is open.
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

// Share the route recovery guard so concurrent chunk failures cannot reload
// indefinitely. Let the failed import reach the error boundary after the retry.
window.addEventListener("vite:preloadError", () => {
  recoverFromStaleChunk();
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
