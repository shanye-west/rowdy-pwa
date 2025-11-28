import { useEffect } from "react";
import { useRouteError, isRouteErrorResponse, useNavigate } from "react-router-dom";
import Layout from "./Layout";

/**
 * Error boundary for route errors.
 * Handles stale service worker cache issues by triggering SW update and offering reload.
 */
export default function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  // Check if this is a stale cache / MIME type error
  const isStaleCache = 
    error instanceof Error && 
    (error.message.includes("MIME type") || 
     error.message.includes("text/html") ||
     error.message.includes("Failed to fetch dynamically imported module"));

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

  // Auto-reload for stale cache errors after a short delay
  useEffect(() => {
    if (isStaleCache) {
      const timer = setTimeout(() => {
        window.location.reload();
      }, 2000);
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
          <p className="text-slate-500 mb-6">
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
          <p className="text-slate-500">
            A new version is available. Reloading...
          </p>
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
        <p className="text-slate-500 mb-6">
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
            className="px-6 py-3 border border-slate-300 rounded-lg font-semibold hover:bg-slate-50 transition-colors"
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
        <p className="text-slate-500 mb-6">
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
