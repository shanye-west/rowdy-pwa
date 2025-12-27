import React, { Suspense, lazy, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Outlet, useLocation, useNavigationType } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import "./index.css";
import "./firebase";
import { AuthProvider } from "./contexts/AuthContext";
import { TournamentProvider } from "./contexts/TournamentContext";
import { PageMetaProvider, usePageMetaContext } from "./contexts/PageMetaContext";
import App from "./App";
import ErrorBoundary, { NotFound } from "./components/ErrorBoundary";
import Layout from "./components/Layout";

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
const RouteLoader = () => <div className="py-20" aria-hidden="true" />;

function RootWrapper() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const reduceMotion = useReducedMotion();
  const easeOut: [number, number, number, number] = [0.22, 1, 0.36, 1];
  const easeIn: [number, number, number, number] = [0.4, 0, 1, 1];
  const { meta } = usePageMetaContext();
  const direction = navigationType === "POP" ? -1 : 1;

  useEffect(() => {
    try { window.scrollTo({ top: 0, left: 0 }); } catch (e) {}
  }, [location.pathname]);

  const variants = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.01 } },
        exit: { opacity: 0, transition: { duration: 0.01 } },
      }
    : {
        initial: (dir: number) => ({ opacity: 0, x: dir > 0 ? 80 : -80 }),
        animate: {
          opacity: 1,
          x: 0,
          transition: { duration: 0.45, ease: easeOut },
        },
        exit: (dir: number) => ({
          opacity: 0,
          x: dir > 0 ? -80 : 80,
          transition: { duration: 0.35, ease: easeIn },
        }),
      };

  return (
    <Layout
      title={meta.title ?? "Rowdy Cup"}
      series={meta.series}
      showBack={meta.showBack}
      tournamentLogo={meta.tournamentLogo}
    >
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={location.pathname}
          custom={direction}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          style={{ minHeight: "100%", width: "100%", willChange: reduceMotion ? "opacity" : "transform, opacity" }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </Layout>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <PageMetaProvider>
        <RootWrapper />
      </PageMetaProvider>
    ),
    errorElement: <ErrorBoundary />,
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
        <RouterProvider router={router} />
      </TournamentProvider>
    </AuthProvider>
  </React.StrictMode>
);
