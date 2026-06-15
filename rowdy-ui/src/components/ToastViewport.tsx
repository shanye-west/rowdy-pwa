import { memo } from "react";
import { AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";
import type { Toast, ToastVariant } from "../contexts/ToastContext";

const VARIANT_CLASS: Record<ToastVariant, string> = {
  info: "bg-slate-900/95",
  success: "bg-emerald-600/95",
  error: "bg-red-600/95",
};

const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

interface ToastViewportProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

/** Fixed, stacked toast container rendered once by ToastProvider. */
export const ToastViewport = memo(function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-viewport" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const variant = toast.variant ?? "info";
        const Icon = VARIANT_ICON[variant];
        return (
          <div key={toast.id} className={`toast ${VARIANT_CLASS[variant]}`}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-sm font-medium leading-snug">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="shrink-0 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                onClick={() => {
                  toast.action!.onClick();
                  onDismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss notification"
              className="shrink-0 rounded-md p-0.5 text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              onClick={() => onDismiss(toast.id)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
});

export default ToastViewport;
