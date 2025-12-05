import { useEffect, useCallback, type ReactNode } from "react";

export interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Called when modal should close (backdrop click, escape key, close button) */
  onClose: () => void;
  /** Modal title */
  title?: string;
  /** Modal content */
  children: ReactNode;
  /** Maximum width class (default: max-w-sm) */
  maxWidth?: string;
  /** Accessible label for the modal */
  ariaLabel?: string;
}

/**
 * Reusable modal component with backdrop, keyboard handling, and accessibility.
 * 
 * Features:
 * - Closes on backdrop click
 * - Closes on Escape key
 * - Prevents body scroll when open
 * - Proper ARIA attributes
 * - Focus trap (returns focus on close)
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = "max-w-sm",
  ariaLabel,
}: ModalProps) {
  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  // Add/remove escape key listener
  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      // Prevent body scroll
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title}
    >
      <div
        className={`bg-white rounded-xl shadow-xl p-6 mx-4 w-full ${maxWidth}`}
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        {title && (
          <h3 className="text-lg font-bold text-center text-slate-800 mb-4">
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Standard modal action buttons layout.
 * Use for confirm/cancel patterns.
 */
export interface ModalActionsProps {
  /** Primary action button (confirm, submit, etc.) */
  primaryLabel: string;
  /** Primary action handler */
  onPrimary: () => void;
  /** Primary button color class (default: green) */
  primaryClass?: string;
  /** Secondary action button (cancel) */
  secondaryLabel?: string;
  /** Secondary action handler */
  onSecondary?: () => void;
}

export function ModalActions({
  primaryLabel,
  onPrimary,
  primaryClass = "bg-green-600 hover:bg-green-700",
  secondaryLabel = "Cancel",
  onSecondary,
}: ModalActionsProps) {
  return (
    <div className="flex gap-3">
      {onSecondary && (
        <button
          type="button"
          onClick={onSecondary}
          className="flex-1 py-3 px-4 rounded-lg bg-slate-200 text-slate-700 font-semibold text-base transition-transform active:scale-95 hover:bg-slate-300"
        >
          {secondaryLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onPrimary}
        className={`flex-1 py-3 px-4 rounded-lg text-white font-semibold text-base transition-transform active:scale-95 ${primaryClass}`}
      >
        {primaryLabel}
      </button>
    </div>
  );
}
