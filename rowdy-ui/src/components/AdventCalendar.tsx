import { useState } from "react";

/**
 * Christmas advent calendar leading to the first tee: one door per December day
 * up to (and including) tee day, which gets the big door. Past doors are open,
 * today's door opens on tap (remembered per device), future doors stay shut.
 */

type Props = {
  /** Tee day, "YYYY-MM-DD". Doors run Dec 1 → this day (December only). */
  teeYmd: string;
  /** Viewer's current date. */
  now: Date;
};

// One surprise per door; tee day uses TEE_DAY. Wraps if a calendar is longer.
const DOORS: { emoji: string; line: string }[] = [
  { emoji: "🎄", line: "Advent has begun. Start hiding your slice from the family." },
  { emoji: "⛄", line: "Snowmen (8s) count the same as everywhere else. Avoid them." },
  { emoji: "🎁", line: "The best gift is a 4-footer your opponent concedes." },
  { emoji: "🦌", line: "Rudolph's nose: also the colour of your face after a three-putt." },
  { emoji: "🔔", line: "Jingle bells, my ball's in the trees, again." },
  { emoji: "🧦", line: "Stocking stuffer idea: a dozen balls. You'll need them." },
  { emoji: "🍪", line: "Leave cookies out for the Rules Official." },
  { emoji: "⭐", line: "Two weeks to tee day. Practice green or eggnog? Why not both." },
  { emoji: "🕯️", line: "Light a candle for every lost ball of 2026." },
  { emoji: "🎅", line: "He knows if you've been sandbagging. Be good for goodness' sake." },
  { emoji: "❄️", line: "Frost delays are not an excuse for slow play." },
  { emoji: "🏌️", line: "Twelve days of Christmas: twelve range balls, minimum." },
  { emoji: "🥧", line: "Grip it like you're carrying the last slice of pie." },
  { emoji: "🎶", line: "Fa-la-la-la-laaa — that's the sound of a lip-out." },
  { emoji: "🍫", line: "One week to go. Scout the enemy." },
  { emoji: "🧣", line: "Layers. You will be cold on the first tee. Everyone is." },
  { emoji: "🛷", line: "Sleigh ride = eagle. Make it happen." },
  { emoji: "🎀", line: "Tie a bow on your bets — the Sportsbook is open." },
  { emoji: "🥂", line: "Three sleeps. Hydrate (with water, at least once)." },
  { emoji: "🌟", line: "Pick your walk-up song. The reindeer will judge it." },
  { emoji: "📦", line: "Pack the clubs. Pack the ugly sweater. Pack both." },
];
const TEE_DAY = { emoji: "⛳", line: "It's tee day! Merry Christmas — go win some points." };

const STORAGE_KEY = "rowdy:adventOpened";

function readOpened(): Record<string, 1> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeOpened(map: Record<string, 1>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage blocked — the door just won't be remembered */
  }
}

export default function AdventCalendar({ teeYmd, now }: Props) {
  const [y, m, teeDay] = teeYmd.split("-").map(Number);
  const [opened, setOpened] = useState(readOpened);
  const [selected, setSelected] = useState<number | null>(null);

  if (m !== 12) return null; // only a December tee day makes an advent calendar

  // Viewer's position relative to December of the tee year.
  const todayKey = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const doorKey = (day: number) => y * 10000 + 1200 + day;
  const doorId = (day: number) => `${teeYmd}:${day}`;

  const contentFor = (day: number) => (day === teeDay ? TEE_DAY : DOORS[(day - 1) % DOORS.length]);

  const handleTap = (day: number) => {
    const key = doorKey(day);
    if (key > todayKey) return; // not yet
    if (key === todayKey && !opened[doorId(day)]) {
      const next = { ...opened, [doorId(day)]: 1 as const };
      setOpened(next);
      writeOpened(next);
    }
    setSelected(day);
  };

  const days = Array.from({ length: teeDay }, (_, i) => i + 1);
  const selectedContent = selected !== null ? contentFor(selected) : null;
  const beforeAdvent = todayKey < doorKey(1);

  return (
    <div className="space-y-3">
      <div className="advent-grid">
        {days.map((day) => {
          const key = doorKey(day);
          const isTee = day === teeDay;
          const isPast = key < todayKey;
          const isToday = key === todayKey;
          const isOpen = isPast || (isToday && !!opened[doorId(day)]);
          const content = contentFor(day);
          const state = isOpen ? "open" : isToday ? "today" : "locked";
          return (
            <button
              key={day}
              type="button"
              onClick={() => handleTap(day)}
              disabled={state === "locked"}
              data-state={state}
              data-selected={selected === day || undefined}
              className={`advent-door${isTee ? " advent-door--tee" : ""}`}
              aria-label={
                state === "locked"
                  ? `December ${day}, opens on the day`
                  : state === "today"
                    ? `December ${day}, open today's door`
                    : `December ${day}: ${content.line}`
              }
            >
              <span className="advent-door-inner">
                <span className="advent-face advent-face--front">
                  <span className="advent-num">{day}</span>
                  {isTee && <span className="advent-tee-label">First tee</span>}
                </span>
                <span className="advent-face advent-face--back" aria-hidden="true">
                  <span className={isTee ? "text-3xl" : "text-xl"}>{content.emoji}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-h-[2.5rem] px-1 text-center text-xs font-medium text-muted-foreground" aria-live="polite">
        {selectedContent ? (
          <>
            <span className="font-semibold text-foreground">Dec {selected}:</span> {selectedContent.line}
          </>
        ) : beforeAdvent ? (
          "The first door opens December 1."
        ) : opened[doorId(Math.min(now.getDate(), teeDay))] || todayKey > doorKey(teeDay) ? (
          "Tap any open door to read it again."
        ) : (
          "Today's door is waiting — tap it to open."
        )}
      </div>
    </div>
  );
}
