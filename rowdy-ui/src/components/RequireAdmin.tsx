import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Layout from "./Layout";

/**
 * Route guard for admin-only pages.
 *
 * Admin writes are ultimately enforced server-side (the admin callables in
 * functions/src/index.ts query players by authUid and check `isAdmin`), so this
 * is a UX guard, not the security boundary — it stops non-admins from seeing
 * admin forms and then hitting a permission error on submit.
 *
 * Waits for auth to resolve before deciding, so an admin refreshing the page
 * doesn't briefly flash "Access Denied".
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { player, loading } = useAuth();

  if (loading) {
    return (
      <Layout title="Loading..." showBack>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="spinner-lg" />
        </div>
      </Layout>
    );
  }

  if (!player?.isAdmin) {
    return (
      <Layout title="Admin" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div className="empty-state-text">Access Denied</div>
          <div className="text-sm text-gray-500 mt-2">Admin access required</div>
          <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
        </div>
      </Layout>
    );
  }

  return <>{children}</>;
}
