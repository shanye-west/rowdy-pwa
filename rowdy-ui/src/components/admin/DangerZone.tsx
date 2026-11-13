import type { ReactNode } from "react";
import AdminSection from "./AdminSection";
import { dangerButtonClass } from "./inputStyles";
import { Button } from "../ui/button";

export interface DangerZoneProps {
  title: ReactNode;
  description?: ReactNode;
  /** Button text — name the thing being destroyed ("Delete round"). */
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  /** Extra content above the button (e.g. a type-to-confirm input). */
  children?: ReactNode;
}

/**
 * The destructive section that closes an admin page. Always last, always the
 * same shape, and the button only ever opens a ConfirmDialog.
 */
export default function DangerZone({ title, description, actionLabel, onAction, disabled, children }: DangerZoneProps) {
  return (
    <AdminSection title={title} description={description} danger>
      <div className="space-y-3">
        {children}
        <Button type="button" variant="outline" onClick={onAction} disabled={disabled} className={dangerButtonClass}>
          {actionLabel}
        </Button>
      </div>
    </AdminSection>
  );
}
