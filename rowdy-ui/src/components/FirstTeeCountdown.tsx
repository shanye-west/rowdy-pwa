import { useEffect, useState } from "react";
import { Card, CardContent } from "./ui/card";
import { teeTimeToMillis } from "../utils";

type Props = {
  /** "YYYY-MM-DD" (day countdown) or "YYYY-MM-DDTHH:MM" venue wall-clock (live clock). */
  firstTee: string;
  isChristmas: boolean;
};

const DAY_MS = 86_400_000;

/** Whole calendar days from the viewer's today to `ymd`, on the viewer's calendar. */
function daysUntilDate(ymd: string, now: Date): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / DAY_MS);
}

function formatLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatClock(hhmm: string): string {
  const [h, min] = hhmm.split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * Home-page countdown to the tournament's first tee. Festive copy ("sleeps")
 * for the Christmas Classic; plain "days" otherwise. Renders nothing once the
 * first tee has passed.
 */
export default function FirstTeeCountdown({ firstTee, isChristmas }: Props) {
  const [ymd, hhmm] = firstTee.split("T");
  const hasTime = !!hhmm;
  const targetMs = hasTime ? teeTimeToMillis(firstTee) : null;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // A live clock ticks every second in the final day; otherwise once a
    // minute is plenty to roll the day count over at midnight.
    const msLeft = targetMs !== null ? targetMs - Date.now() : Infinity;
    const id = window.setInterval(() => setNow(new Date()), msLeft < DAY_MS ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  const days = daysUntilDate(ymd, now);
  const msLeft = targetMs !== null ? targetMs - now.getTime() : null;

  // Done: past the tee time, or (date-only) past the day itself.
  if (msLeft !== null ? msLeft <= 0 : days < 0) return null;

  const dateLine = `${formatLongDate(ymd)}${hasTime ? ` · ${formatClock(hhmm)}` : ""}`;
  const unit = isChristmas ? (days === 1 ? "sleep" : "sleeps") : days === 1 ? "day" : "days";

  let headline: React.ReactNode;
  if (msLeft !== null && msLeft < DAY_MS) {
    // Final stretch with a known tee time: live h/m/s clock.
    const s = Math.floor(msLeft / 1000);
    const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
    headline = (
      <div className="font-mono text-5xl font-bold tabular-nums tracking-tight text-primary">
        {parts.map((n) => String(n).padStart(2, "0")).join(":")}
      </div>
    );
  } else if (days === 0) {
    headline = (
      <div className="text-3xl font-bold tracking-tight text-primary">
        {isChristmas ? "🎄 It's tee day! 🎄" : "It's tee day!"}
      </div>
    );
  } else {
    headline = (
      <div className="flex items-baseline justify-center gap-2">
        <span className="text-6xl font-bold tabular-nums tracking-tight text-primary">{days}</span>
        <span className="text-xl font-semibold text-foreground">{unit}</span>
      </div>
    );
  }

  return (
    <section aria-label="Countdown to the first tee">
      <Card
        className={
          isChristmas
            ? "relative overflow-hidden border-2 border-[#00863c]/30 bg-card/85 shadow-lg"
            : "border-border/80 bg-card/80"
        }
      >
        {isChristmas && (
          // Candy-cane ribbon along the top edge.
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1.5"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, #ef211c 0 10px, #ffffff 10px 20px)",
            }}
          />
        )}
        <CardContent className="space-y-1 pb-5 pt-6 text-center">
          <div className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            {isChristmas ? "🎅 Countdown to the first tee" : "Countdown to the first tee"}
          </div>
          {headline}
          <div className="text-xs font-medium text-muted-foreground">{dateLine}</div>
        </CardContent>
      </Card>
    </section>
  );
}
