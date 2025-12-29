import React, { Suspense, lazy } from "react";
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

// Lazy load routes for code splitting - reduces initial bundle size
const Match = lazy(() => import("./routes/Match"));
const Round = lazy(() => import("./routes/Round"));
const Skins = lazy(() => import("./routes/Skins"));
const RoundRecap = lazy(() => import("./routes/RoundRecap"));
const Teams = lazy(() => import("./routes/Teams"));
const Login = lazy(() => import("./routes/Login"));
const History = lazy(() => import("./routes/History"));
const Tournament = lazy(() => import("./routes/Tournament"));
const Admin = lazy(() => import("./routes/Admin"));
const AddMatch = lazy(() => import("./routes/AddMatch"));
const EditMatch = lazy(() => import("./routes/EditMatch"));
const RecalculateMatchStrokes = lazy(() => import("./routes/RecalculateMatchStrokes"));
const RecalculateTournamentStats = lazy(() => import("./routes/RecalculateTournamentStats"));
const GenerateRoundRecap = lazy(() => import("./routes/GenerateRoundRecap"));

// Loading fallback for lazy-loaded routes
const RouteLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="spinner-lg"></div>
  </div>
);

const router = createBrowserRouter([
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
      { path: "round/:roundId", element: <Suspense fallback={<RouteLoader />}><Round /></Suspense> },
      { path: "round/:roundId/skins", element: <Suspense fallback={<RouteLoader />}><Skins /></Suspense> },
      { path: "round/:roundId/recap", element: <Suspense fallback={<RouteLoader />}><RoundRecap /></Suspense> },
      { path: "match/:matchId", element: <Suspense fallback={<RouteLoader />}><Match /></Suspense> },
      { path: "teams", element: <Suspense fallback={<RouteLoader />}><Teams /></Suspense> },
      { path: "history", element: <Suspense fallback={<RouteLoader />}><History /></Suspense> },
      { path: "tournament/:tournamentId", element: <Suspense fallback={<RouteLoader />}><Tournament /></Suspense> },
      { path: "login", element: <Suspense fallback={<RouteLoader />}><Login /></Suspense> },
      { path: "admin", element: <Suspense fallback={<RouteLoader />}><Admin /></Suspense> },
      { path: "admin/match", element: <Suspense fallback={<RouteLoader />}><AddMatch /></Suspense> },
      { path: "admin/match/edit", element: <Suspense fallback={<RouteLoader />}><EditMatch /></Suspense> },
      { path: "admin/match/recalculate", element: <Suspense fallback={<RouteLoader />}><RecalculateMatchStrokes /></Suspense> },
      { path: "admin/round/recap", element: <Suspense fallback={<RouteLoader />}><GenerateRoundRecap /></Suspense> },
      { path: "admin/tournament/recalculate", element: <Suspense fallback={<RouteLoader />}><RecalculateTournamentStats /></Suspense> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

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
