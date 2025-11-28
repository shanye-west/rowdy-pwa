import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import "./firebase";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";

// Lazy load routes for code splitting - reduces initial bundle size
const Match = lazy(() => import("./routes/Match"));
const Round = lazy(() => import("./routes/Round"));
const Teams = lazy(() => import("./routes/Teams"));
const Login = lazy(() => import("./routes/Login"));

// Loading fallback for lazy-loaded routes
const RouteLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="spinner-lg"></div>
  </div>
);

const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/round/:roundId", element: <Suspense fallback={<RouteLoader />}><Round /></Suspense> },
  { path: "/match/:matchId", element: <Suspense fallback={<RouteLoader />}><Match /></Suspense> },
  { path: "/teams", element: <Suspense fallback={<RouteLoader />}><Teams /></Suspense> },
  { path: "/login", element: <Suspense fallback={<RouteLoader />}><Login /></Suspense> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);