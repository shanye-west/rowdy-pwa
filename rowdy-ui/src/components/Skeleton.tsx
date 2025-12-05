import { memo } from "react";

/** Base skeleton element with shimmer animation */
interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: "none" | "sm" | "md" | "lg" | "full";
}

export const Skeleton = memo(function Skeleton({ 
  className = "", 
  width, 
  height,
  rounded = "md"
}: SkeletonProps) {
  const roundedClass = {
    none: "",
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    full: "rounded-full"
  }[rounded];
  
  return (
    <div 
      className={`bg-slate-200 animate-pulse ${roundedClass} ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
});

/** Skeleton for scorecard table - shows structure while loading */
export const ScorecardSkeleton = memo(function ScorecardSkeleton() {
  const holes = Array.from({ length: 9 }, (_, i) => i);
  
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-max border-collapse text-center text-sm" style={{ minWidth: "100%" }}>
          <thead>
            <tr className="bg-slate-700">
              <th className="sticky left-0 z-10 bg-slate-700 px-3 py-2 w-24">
                <Skeleton width={40} height={16} className="bg-slate-600" />
              </th>
              {holes.map(i => (
                <th key={i} className="py-2 w-11">
                  <Skeleton width={16} height={16} className="bg-slate-600 mx-auto" />
                </th>
              ))}
              <th className="py-2 w-12 bg-slate-600">
                <Skeleton width={24} height={16} className="bg-slate-500 mx-auto" />
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Par row skeleton */}
            <tr className="bg-slate-100">
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5">
                <Skeleton width={24} height={14} />
              </td>
              {holes.map(i => (
                <td key={i} className="py-1.5">
                  <Skeleton width={16} height={14} className="mx-auto" />
                </td>
              ))}
              <td className="py-1.5 bg-slate-200">
                <Skeleton width={20} height={14} className="mx-auto" />
              </td>
            </tr>
            {/* Player row skeletons */}
            {[0, 1, 2, 3].map(row => (
              <tr key={row} className={row < 2 ? "bg-blue-50/30" : "bg-red-50/30"}>
                <td className="sticky left-0 z-10 px-3 py-2" style={{ backgroundColor: row < 2 ? "#eff6ff" : "#fef2f2" }}>
                  <Skeleton width={80} height={16} />
                </td>
                {holes.map(i => (
                  <td key={i} className="py-2">
                    <Skeleton width={40} height={40} rounded="md" className="mx-auto" />
                  </td>
                ))}
                <td className="py-2 bg-slate-100">
                  <Skeleton width={24} height={16} className="mx-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

/** Skeleton for match status card */
export const MatchStatusSkeleton = memo(function MatchStatusSkeleton() {
  return (
    <div className="space-y-3">
      {/* Format pill */}
      <div className="flex justify-center">
        <Skeleton width={100} height={24} rounded="full" />
      </div>
      {/* Status card */}
      <div className="card p-4">
        <div className="flex flex-col items-center gap-2">
          <Skeleton width={120} height={32} />
          <Skeleton width={80} height={20} />
        </div>
      </div>
    </div>
  );
});

/** Skeleton for match card in Round list */
export const MatchCardSkeleton = memo(function MatchCardSkeleton() {
  return (
    <div className="card p-4">
      <div className="flex justify-between items-center">
        <div className="flex-1 space-y-2">
          <Skeleton width="70%" height={18} />
          <Skeleton width="50%" height={14} />
        </div>
        <Skeleton width={60} height={28} rounded="md" />
      </div>
    </div>
  );
});

/** Full page skeleton for Match route */
export const MatchPageSkeleton = memo(function MatchPageSkeleton() {
  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto animate-pulse">
      <MatchStatusSkeleton />
      <ScorecardSkeleton />
    </div>
  );
});

/** Full page skeleton for Round route */
export const RoundPageSkeleton = memo(function RoundPageSkeleton() {
  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto animate-pulse">
      {/* Header */}
      <div className="text-center space-y-2">
        <Skeleton width={200} height={28} className="mx-auto" />
        <Skeleton width={120} height={20} className="mx-auto" />
      </div>
      {/* Score summary */}
      <div className="card p-4">
        <div className="flex justify-around">
          <Skeleton width={60} height={40} />
          <Skeleton width={40} height={20} className="self-center" />
          <Skeleton width={60} height={40} />
        </div>
      </div>
      {/* Match cards */}
      <div className="space-y-3">
        {[0, 1, 2, 3].map(i => (
          <MatchCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
});

export default Skeleton;
