import { Search } from "lucide-react";
import { cn } from "../../lib/utils";
import { inputClass } from "./inputStyles";

/** Search box with the leading magnifier, shared by every filterable admin list. */
export default function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Accessible name — the box has no visible label. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputClass, "pl-9")}
        aria-label={label}
      />
    </div>
  );
}
