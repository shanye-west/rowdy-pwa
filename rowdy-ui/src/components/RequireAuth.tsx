import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Layout from "./Layout";
import LoadingScreen from "./LoadingScreen";

/**
 * Route guard for pages that require a signed-in user (Bets + Chat).
 *
 * This is the UX half of a two-layer gate: the real boundary is the Firestore
 * rules, which now require `request.auth != null` to read bets/betSettlements/
 * comments. This guard stops a logged-out visitor from reaching the page (and
 * hitting permission-denied listeners), and sends them to /login carrying the
 * intended destination so they land back here after signing in.
 *
 * Gates on `user` (signed in), not `player` (signed in AND linked to a roster
 * player) — the requirement is simply "logged in". Personal actions inside the
 * page (placing a bet, posting) still require `player` and gate themselves.
 *
 * Waits for auth to resolve before deciding, so a signed-in user refreshing the
 * page doesn't briefly flash the login redirect.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Layout title="Loading..." showBack>
        <LoadingScreen className="min-h-[60vh]" />
      </Layout>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    );
  }

  return <>{children}</>;
}
