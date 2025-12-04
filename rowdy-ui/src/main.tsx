import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import "./firebase";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";
import ErrorBoundary, { NotFound } from "./components/ErrorBoundary";

// Lazy load routes for code splitting - reduces initial bundle size
const Match = lazy(() => import("./routes/Match"));
const Round = lazy(() => import("./routes/Round"));
const Teams = lazy(() => import("./routes/Teams"));
const Login = lazy(() => import("./routes/Login"));
const History = lazy(() => import("./routes/History"));
const Tournament = lazy(() => import("./routes/Tournament"));

// Loading fallback for lazy-loaded routes
const RouteLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="spinner-lg"></div>
  </div>
);

const router = createBrowserRouter([
  { path: "/", element: <App />, errorElement: <ErrorBoundary /> },
  { path: "/round/:roundId", element: <Suspense fallback={<RouteLoader />}><Round /></Suspense>, errorElement: <ErrorBoundary /> },
  { path: "/match/:matchId", element: <Suspense fallback={<RouteLoader />}><Match /></Suspense>, errorElement: <ErrorBoundary /> },
  { path: "/teams", element: <Suspense fallback={<RouteLoader />}><Teams /></Suspense>, errorElement: <ErrorBoundary /> },
  { path: "/history", element: <Suspense fallback={<RouteLoader />}><History /></Suspense>, errorElement: <ErrorBoundary /> },
  { path: "/tournament/:tournamentId", element: <Suspense fallback={<RouteLoader />}><Tournament /></Suspense>, errorElement: <ErrorBoundary /> },
  { path: "/login", element: <Suspense fallback={<RouteLoader />}><Login /></Suspense>, errorElement: <ErrorBoundary /> },
  // Catch-all 404 route
  { path: "*", element: <NotFound /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);