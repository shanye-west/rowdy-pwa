import { useEffect, useRef, type ReactNode } from "react";

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
 * Reusable modal component using native <dialog> element.
 * 
 * Features:
 * - Native backdrop with ::backdrop pseudo-element
 * - Native Escape key handling
 * - Built-in focus trap and body scroll prevention
 * - Proper ARIA attributes automatically
 * - Top-layer positioning (no z-index needed)
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = "max-w-sm",
  ariaLabel,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync dialog open/close state with isOpen prop
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Handle native dialog close events (Escape key, programmatic close)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onClose();
    };

    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  // Handle backdrop click (click on dialog itself, not on content)
  const handleDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (dialog && e.target === dialog) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      aria-label={ariaLabel || title}
      className="backdrop:bg-black/50 bg-transparent p-0 border-0"
    >
      <div 
        className={`bg-white rounded-xl shadow-xl p-6 ${maxWidth}`}
        style={{ width: 'calc(100vw - 32px)' }}
      >
        {title && (
          <h3 className="text-lg font-bold text-center text-slate-800 mb-4">
            {title}
          </h3>
        )}
        {children}
      </div>
    </dialog>
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
