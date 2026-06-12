import React, { lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import "./firebase";
import { AuthProvider } from "./contexts/AuthContext";
import { TournamentProvider } from "./contexts/TournamentContext";
import { LayoutProvider } from "./contexts/LayoutContext";
import App from "./App";
import ErrorBoundary, { NotFound } from "./components/ErrorBoundary";
import { LayoutShell } from "./components/Layout";
import RequireAdmin from "./components/RequireAdmin";

// Lazy load routes for code splitting - reduces initial bundle size
const Match = lazy(() => import("./routes/Match"));
const Round = lazy(() => import("./routes/Round"));
const Skins = lazy(() => import("./routes/Skins"));
const RoundRecap = lazy(() => import("./routes/RoundRecap"));
const Teams = lazy(() => import("./routes/Teams"));
const Player = lazy(() => import("./routes/Player"));
const Login = lazy(() => import("./routes/Login"));
const History = lazy(() => import("./routes/History"));
const Tournament = lazy(() => import("./routes/Tournament"));
const Admin = lazy(() => import("./routes/Admin"));
const AddMatch = lazy(() => import("./routes/AddMatch"));
const EditMatch = lazy(() => import("./routes/EditMatch"));
const RecalculateMatchStrokes = lazy(() => import("./routes/RecalculateMatchStrokes"));
const RecalculateTournamentStats = lazy(() => import("./routes/RecalculateTournamentStats"));
const GenerateRoundRecap = lazy(() => import("./routes/GenerateRoundRecap"));
const ManageTournament = lazy(() => import("./routes/ManageTournament"));
const ManageRounds = lazy(() => import("./routes/ManageRounds"));
const MatchControls = lazy(() => import("./routes/MatchControls"));
const ManagePlayers = lazy(() => import("./routes/ManagePlayers"));

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
        { path: "round/:roundId/skins", element: <Skins /> },
        { path: "round/:roundId/recap", element: <RoundRecap /> },
        { path: "match/:matchId", element: <Match /> },
        { path: "teams", element: <Teams /> },
        { path: "player/:playerId", element: <Player /> },
        { path: "history", element: <History /> },
        { path: "tournament/:tournamentId", element: <Tournament /> },
        { path: "login", element: <Login /> },
        { path: "admin", element: <RequireAdmin><Admin /></RequireAdmin> },
        { path: "admin/match", element: <RequireAdmin><AddMatch /></RequireAdmin> },
        { path: "admin/match/edit", element: <RequireAdmin><EditMatch /></RequireAdmin> },
        { path: "admin/match/recalculate", element: <RequireAdmin><RecalculateMatchStrokes /></RequireAdmin> },
        { path: "admin/match/controls", element: <RequireAdmin><MatchControls /></RequireAdmin> },
        { path: "admin/round/recap", element: <RequireAdmin><GenerateRoundRecap /></RequireAdmin> },
        { path: "admin/rounds", element: <RequireAdmin><ManageRounds /></RequireAdmin> },
        { path: "admin/tournament", element: <RequireAdmin><ManageTournament /></RequireAdmin> },
        { path: "admin/tournament/recalculate", element: <RequireAdmin><RecalculateTournamentStats /></RequireAdmin> },
        { path: "admin/players", element: <RequireAdmin><ManagePlayers /></RequireAdmin> },
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
          <RouterProvider router={router} />
        </LayoutProvider>
      </TournamentProvider>
    </AuthProvider>
  </React.StrictMode>
);
