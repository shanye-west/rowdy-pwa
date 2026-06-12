import type { ReactNode } from "react";

export interface AdminSectionProps {
  title: string;
  /** Optional explanatory copy shown under the title. */
  description?: ReactNode;
  /** Use for destructive sections to get a red border. */
  danger?: boolean;
  children: ReactNode;
}

/** Titled card section used to group admin controls. */
export default function AdminSection({ title, description, danger = false, children }: AdminSectionProps) {
  return (
    <div className={`card p-6 ${danger ? "border-2 border-red-200" : ""}`}>
      <h2 className={`font-bold mb-2 ${danger ? "text-red-700" : ""}`}>{title}</h2>
      {description && <p className="text-sm text-gray-600 mb-4">{description}</p>}
      {children}
    </div>
  );
}
