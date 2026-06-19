/**
 * ToastContext - lightweight app-level toast notifications.
 *
 * Reuses the existing `role="status" aria-live="polite"` pattern (see
 * SaveStatusIndicator / ConnectionBanner). Use for transient feedback that
 * shouldn't live inline — e.g. a background score-sync failure with a retry
 * action. Auto-dismisses; tap to dismiss early.
 *
 *   const { showToast } = useToast();
 *   showToast({ variant: "error", message: "Couldn't save", action: { label: "Retry", onClick } });
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastViewport } from "../components/ToastViewport";

export type ToastVariant = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Pass 0 to require manual dismiss. Default 4000. */
  duration?: number;
  action?: ToastAction;
}

export interface Toast extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 3;
const DEFAULT_DURATION = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer]
  );

  const showToast = useCallback(
    (opts: ToastOptions) => {
      const id = ++idRef.current;
      const toast: Toast = { variant: "info", duration: DEFAULT_DURATION, ...opts, id };
      setToasts((prev) => {
        const next = [...prev, toast];
        // Keep only the most recent MAX_TOASTS; clear timers for any we drop.
        if (next.length > MAX_TOASTS) {
          next.slice(0, next.length - MAX_TOASTS).forEach((t) => clearTimer(t.id));
          return next.slice(next.length - MAX_TOASTS);
        }
        return next;
      });
      if (toast.duration && toast.duration > 0) {
        timersRef.current.set(id, setTimeout(() => dismissToast(id), toast.duration));
      }
      return id;
    },
    [clearTimer, dismissToast]
  );

  // Flush any outstanding timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
