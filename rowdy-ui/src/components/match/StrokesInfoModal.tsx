import { useState } from "react";
import { Modal } from "../Modal";
import type { MatchDoc, TournamentDoc, RoundDoc, CourseDoc } from "../../types";

type StrokesInfoModalProps = {
  isOpen: boolean;
  onClose: () => void;
  match: MatchDoc;
  tournament: TournamentDoc | null;
  course: CourseDoc | null;
  round: RoundDoc | null;
  getPlayerName: (playerId: string | undefined) => string;
  getCourseHandicapFor: (team: "A" | "B", pIdx: number) => number | null;
};

export function StrokesInfoModal({
  isOpen,
  onClose,
  match,
  tournament,
  course,
  round,
  getPlayerName,
  getCourseHandicapFor,
}: StrokesInfoModalProps) {
  const [defTooltip, setDefTooltip] = useState<{ key: string; x: number; y: number } | null>(null);

  const openDefTooltip = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const button = e.currentTarget as HTMLElement;
    const buttonRect = button.getBoundingClientRect();
    const container = button.closest('.relative') as HTMLElement;
    const containerRect = container?.getBoundingClientRect();
    
    if (containerRect) {
      // Calculate position relative to the container
      const x = buttonRect.left - containerRect.left + buttonRect.width / 2;
      const y = buttonRect.top - containerRect.top;
      setDefTooltip({ key, x, y });
    }
  };

  // Helper to get handicap index for a player
  const getHandicapIndex = (playerId: string): number | null => {
    return tournament?.teamA?.handicapByPlayer?.[playerId] ?? 
           tournament?.teamB?.handicapByPlayer?.[playerId] ?? 
           null;
  };

  // Helper to calculate skins strokes for a player
  const calculateSkinsStrokesCount = (playerId: string): number => {
    if (!course || !round) return 0;
    const handicapIndex = getHandicapIndex(playerId);
    if (handicapIndex == null) return 0;
    
    const skinsPercent = round.skinsHandicapPercent ?? 100;
    const courseHandicap = (handicapIndex * ((course.slope || 113) / 113)) + ((course.rating || 72) - (course.par || 72));
    const adjustedHandicap = courseHandicap * (skinsPercent / 100);
    return Math.round(adjustedHandicap);
  };

  // Build player rows
  const playerRows: Array<{
    name: string;
    hi: number | null;
    ch: number | null;
    so: number;
    sh: number;
  }> = [];

  // Team A players
  match.teamAPlayers?.forEach((p, idx) => {
    const handicapIndex = getHandicapIndex(p.playerId);
    const courseHandicap = getCourseHandicapFor("A", idx);
    const strokesOff = p.strokesReceived?.reduce((sum, s) => sum + s, 0) ?? 0;
    const skinsHandicap = calculateSkinsStrokesCount(p.playerId);
    
    playerRows.push({
      name: getPlayerName(p.playerId),
      hi: handicapIndex,
      ch: courseHandicap,
      so: strokesOff,
      sh: skinsHandicap,
    });
  });

  // Team B players
  match.teamBPlayers?.forEach((p, idx) => {
    const handicapIndex = getHandicapIndex(p.playerId);
    const courseHandicap = getCourseHandicapFor("B", idx);
    const strokesOff = p.strokesReceived?.reduce((sum, s) => sum + s, 0) ?? 0;
    const skinsHandicap = calculateSkinsStrokesCount(p.playerId);
    
    playerRows.push({
      name: getPlayerName(p.playerId),
      hi: handicapIndex,
      ch: courseHandicap,
      so: strokesOff,
      sh: skinsHandicap,
    });
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Handicap Information"
      ariaLabel="Handicap information for match players"
      maxWidth="max-w-2xl"
    >
      <div onClick={() => setDefTooltip(null)} className="relative">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-2 font-semibold text-slate-700">Player</th>
              <th className="text-left py-2 px-2 font-semibold text-slate-700">
                <button
                  onClick={(e) => openDefTooltip(e, "HI")}
                  aria-label="Define H.I."
                  className="flex items-center gap-1 focus:outline-none hover:opacity-70 active:opacity-50 -my-2 py-2"
                >
                  <span>H.I.</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <circle cx="12" cy="16" r="1" />
                  </svg>
                </button>
              </th>
              <th className="text-left py-2 px-2 font-semibold text-slate-700">
                <button
                  onClick={(e) => openDefTooltip(e, "CH")}
                  aria-label="Define C.H."
                  className="flex items-center gap-1 focus:outline-none hover:opacity-70 active:opacity-50 -my-2 py-2"
                >
                  <span>C.H.</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <circle cx="12" cy="16" r="1" />
                  </svg>
                </button>
              </th>
              <th className="text-left py-2 px-2 font-semibold text-slate-700">
                <button
                  onClick={(e) => openDefTooltip(e, "SO")}
                  aria-label="Define S.O."
                  className="flex items-center gap-1 focus:outline-none hover:opacity-70 active:opacity-50 -my-2 py-2"
                >
                  <span>S.O.</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <circle cx="12" cy="16" r="1" />
                  </svg>
                </button>
              </th>
              <th className="text-left py-2 px-2 font-semibold text-slate-700">
                <button
                  onClick={(e) => openDefTooltip(e, "SH")}
                  aria-label="Define S.H."
                  className="flex items-center gap-1 focus:outline-none hover:opacity-70 active:opacity-50 -my-2 py-2"
                >
                  <span>S.H.</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <circle cx="12" cy="16" r="1" />
                  </svg>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {playerRows.map((row, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 px-2 text-slate-800">{row.name}</td>
                <td className="py-2 px-2 text-left text-slate-600">{row.hi != null ? row.hi.toFixed(1) : "—"}</td>
                <td className="py-2 px-2 text-left text-slate-600">{row.ch != null ? row.ch : "—"}</td>
                <td className="py-2 px-2 text-left text-slate-600">{row.so}</td>
                <td className="py-2 px-2 text-left text-slate-600">{row.sh}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {defTooltip && (() => {
          const defs: Record<string, string> = {
            HI: "Handicap Index",
            CH: "Course Handicap",
            SO: "Matchplay Strokes",
            SH: "Skins Strokes",
          };
          const text = defs[defTooltip.key] ?? "";
          return (
            <div 
              style={{ 
                position: 'absolute', 
                left: `${defTooltip.x}px`, 
                top: `${defTooltip.y}px`, 
                transform: 'translate(-50%, calc(-100% - 8px))'
              }}
              className="pointer-events-none z-50"
            >
              <div className="bg-slate-800 text-white text-sm px-3 py-2 rounded-lg shadow-lg whitespace-nowrap">
                {text}
              </div>
            </div>
          );
        })()}
      </div>
    </Modal>
  );
}
