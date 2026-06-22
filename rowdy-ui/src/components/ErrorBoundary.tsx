import { useEffect } from "react";
import { useRouteError, isRouteErrorResponse, useNavigate } from "react-router-dom";
import Layout from "./Layout";
import { recoverFromStaleChunk } from "../utils/swRecovery";

/**
 * Error boundary for route errors.
 * Handles stale service worker cache issues by triggering SW update and offering reload.
 */
export default function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  const message = error instanceof Error ? error.message.toLowerCase() : "";

  // Stale cache / failed-chunk-load error (triggers auto-recovery). Covers the
  // varied messages browsers emit — Chrome ("failed to fetch dynamically
  // imported module"), Firefox ("error loading dynamically imported module"),
  // and Safari/iOS ("importing a module script failed"), plus MIME-type errors
  // from a stale index.html being served for a .js request.
  const isStaleCache =
    message.includes("mime type") ||
    message.includes("text/html") ||
    message.includes("dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("module script failed") ||
    message.includes("loading chunk") ||
    message.includes("chunkloaderror");

  // Check if this is a network/offline error
  const isNetworkError =
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("failed to fetch") ||
    message.includes("internet");

  // Check if this is a permission/auth error
  const isPermissionError =
    message.includes("permission") ||
    message.includes("unauthorized") ||
    message.includes("unauthenticated");

  // Trigger service worker update check on error
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) {
          reg.update().catch(console.error);
        }
      });
    }
  }, []);

  // Auto-recover from stale cache / failed chunk loads after a short delay.
  useEffect(() => {
    if (isStaleCache) {
      const timer = setTimeout(recoverFromStaleChunk, 2000);
      return () => clearTimeout(timer);
    }
  }, [isStaleCache]);

  // Handle 404 errors
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <Layout title="Not Found" showBack>
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold mb-2">Page Not Found</h1>
          <p className="text-muted-foreground mb-6">
            The page you're looking for doesn't exist.
          </p>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Go Home
          </button>
        </div>
      </Layout>
    );
  }

  // Handle stale cache / module loading errors
  if (isStaleCache) {
    return (
      <Layout title="Updating...">
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="spinner-lg mb-4"></div>
          <h1 className="text-xl font-bold mb-2">Updating App</h1>
          <p className="text-muted-foreground">
            A new version is available. Reloading...
          </p>
        </div>
      </Layout>
    );
  }

  // Handle network/offline errors
  if (isNetworkError) {
    return (
      <Layout title="Connection Error" showBack>
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="text-6xl mb-4">📶</div>
          <h1 className="text-2xl font-bold mb-2">Connection Problem</h1>
          <p className="text-muted-foreground mb-6">
            Please check your internet connection and try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </Layout>
    );
  }

  // Handle permission/auth errors
  if (isPermissionError) {
    return (
      <Layout title="Access Denied" showBack>
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-6">
            You don't have permission to access this page.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => navigate("/login")}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Login
            </button>
            <button
              onClick={() => navigate("/")}
              className="px-6 py-3 border border-border rounded-lg font-semibold hover:bg-muted transition-colors"
            >
              Go Home
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // Generic error fallback
  return (
    <Layout title="Error" showBack>
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="text-6xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold mb-2">Something Went Wrong</h1>
        <p className="text-muted-foreground mb-6">
          {error instanceof Error ? error.message : "An unexpected error occurred."}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Reload
          </button>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-3 border border-border rounded-lg font-semibold hover:bg-muted transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    </Layout>
  );
}

/**
 * Simple 404 page for the catch-all route
 */
export function NotFound() {
  const navigate = useNavigate();

  return (
    <Layout title="Not Found" showBack>
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="text-6xl mb-4">🔍</div>
        <h1 className="text-2xl font-bold mb-2">Page Not Found</h1>
        <p className="text-muted-foreground mb-6">
          The page you're looking for doesn't exist.
        </p>
        <button
          onClick={() => navigate("/")}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          Go Home
        </button>
      </div>
    </Layout>
  );
}
