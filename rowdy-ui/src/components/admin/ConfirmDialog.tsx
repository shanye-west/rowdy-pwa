import type { ReactNode } from "react";
import { Modal, ModalActions } from "../Modal";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Body content — a string or richer JSX (e.g. a match count warning). */
  children: ReactNode;
  confirmLabel?: string;
  /** Label for the dismiss button (defaults to "Cancel"). */
  cancelLabel?: string;
  /** Use for destructive actions to get a red confirm button. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Simple confirmation dialog for admin actions. */
export default function ConfirmDialog({
  isOpen,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title}>
      <div className="text-sm text-gray-700 mb-4">{children}</div>
      <ModalActions
        primaryLabel={busy ? "Working..." : confirmLabel}
        onPrimary={busy ? () => {} : onConfirm}
        primaryClass={danger ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}
        secondaryLabel={cancelLabel}
        onSecondary={onCancel}
      />
    </Modal>
  );
}
