import React, { lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import "./index.css";
import "./firebase";
import { AuthProvider } from "./contexts/AuthContext";
import { TournamentProvider } from "./contexts/TournamentContext";
import { LayoutProvider } from "./contexts/LayoutContext";
import { ToastProvider } from "./contexts/ToastContext";
import App from "./App";
import ErrorBoundary, { NotFound } from "./components/ErrorBoundary";
import { LayoutShell } from "./components/Layout";
import RequireAdmin from "./components/RequireAdmin";

// Lazy load routes for code splitting - reduces initial bundle size
const Match = lazy(() => import("./routes/Match"));
const Round = lazy(() => import("./routes/Round"));
const Pairings = lazy(() => import("./routes/Pairings"));
const Skins = lazy(() => import("./routes/Skins"));
const RoundRecap = lazy(() => import("./routes/RoundRecap"));
const Teams = lazy(() => import("./routes/Teams"));
const Leaderboard = lazy(() => import("./routes/Leaderboard"));
const Sportsbook = lazy(() => import("./routes/Sportsbook"));
const Player = lazy(() => import("./routes/Player"));
const Login = lazy(() => import("./routes/Login"));
const History = lazy(() => import("./routes/History"));
const Tournament = lazy(() => import("./routes/Tournament"));
const AdminDashboard = lazy(() => import("./routes/admin/AdminDashboard"));
const AdminTournamentLayout = lazy(() => import("./routes/admin/AdminTournamentLayout"));
const TournamentHome = lazy(() => import("./routes/admin/TournamentHome"));
const TournamentSettings = lazy(() => import("./routes/admin/TournamentSettings"));
const RoundAdmin = lazy(() => import("./routes/admin/RoundAdmin"));
const MatchCreate = lazy(() => import("./routes/admin/MatchCreate"));
const MatchAdmin = lazy(() => import("./routes/admin/MatchAdmin"));
const PlayersAdmin = lazy(() => import("./routes/admin/PlayersAdmin"));
const CoursesAdmin = lazy(() => import("./routes/admin/CoursesAdmin"));
const CourseEdit = lazy(() => import("./routes/admin/CourseEdit"));
const RecalculateTournamentStats = lazy(() => import("./routes/RecalculateTournamentStats"));

// No loading fallback - CSS View Transitions handle page navigation smoothly
const router = createBrowserRouter(
  [
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
        { path: "leaderboard", element: <Leaderboard /> },
        { path: "sportsbook", element: <Sportsbook /> },
        { path: "player/:playerId", element: <Player /> },
        { path: "history", element: <History /> },
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <TournamentProvider>
        <LayoutProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </LayoutProvider>
      </TournamentProvider>
    </AuthProvider>
  </React.StrictMode>
);
