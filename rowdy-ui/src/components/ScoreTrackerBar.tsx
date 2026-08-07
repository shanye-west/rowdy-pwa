type ScoreTrackerBarProps = {
  totalPoints: number;
  teamAConfirmed: number;
  teamBConfirmed: number;
  teamAPending: number;
  teamBPending: number;
  teamAColor?: string;
  teamBColor?: string;
};

type BoxFill = {
  aConfirmed: number; // 0..1 - Team A confirmed share of this box
  aPending: number;   // 0..1 - Team A pending share, sits just right of the confirmed share
  bConfirmed: number; // 0..1 - Team B confirmed share (anchored to the box's right edge)
  bPending: number;   // 0..1 - Team B pending share, sits just left of its confirmed share
};

const clampPoints = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Ryder Cup-style score tracker bar.
 * Boxes fill left→right for Team A, right→left for Team B.
 * Confirmed points = solid color, pending points = transparent/lighter color.
 * Half-points (halves) fill half a box.
 *
 * Every box is an equal flex share of the container with no minimum width, so the
 * strip always fits the card: the segment separators and the midpoint marker are
 * positioned as percentages of that same container and stay aligned with the fills.
 */
export default function ScoreTrackerBar({
  totalPoints,
  teamAConfirmed,
  teamBConfirmed,
  teamAPending,
  teamBPending,
  teamAColor = "var(--team-a-default)",
  teamBColor = "var(--team-b-default)",
}: ScoreTrackerBarProps) {
  const boxCount = Math.floor(clampPoints(totalPoints));
  if (boxCount <= 0) return null;

  const boxes: BoxFill[] = Array.from({ length: boxCount }, () => ({
    aConfirmed: 0,
    aPending: 0,
    bConfirmed: 0,
    bPending: 0,
  }));

  // Fill Team A from the left: confirmed points first, then pending behind them.
  let aConfirmedLeft = clampPoints(teamAConfirmed);
  let aPendingLeft = clampPoints(teamAPending);
  for (let i = 0; i < boxCount && aConfirmedLeft + aPendingLeft > 0; i++) {
    const confirmed = Math.min(aConfirmedLeft, 1);
    boxes[i].aConfirmed = confirmed;
    aConfirmedLeft -= confirmed;

    const pending = Math.min(aPendingLeft, 1 - confirmed);
    boxes[i].aPending = pending;
    aPendingLeft -= pending;
  }

  // Fill Team B from the right, into whatever space Team A left in each box.
  let bConfirmedLeft = clampPoints(teamBConfirmed);
  let bPendingLeft = clampPoints(teamBPending);
  for (let i = boxCount - 1; i >= 0 && bConfirmedLeft + bPendingLeft > 0; i--) {
    const room = Math.max(0, 1 - boxes[i].aConfirmed - boxes[i].aPending);
    if (room <= 0) continue;

    const confirmed = Math.min(bConfirmedLeft, room);
    boxes[i].bConfirmed = confirmed;
    bConfirmedLeft -= confirmed;

    const pending = Math.min(bPendingLeft, room - confirmed);
    boxes[i].bPending = pending;
    bPendingLeft -= pending;
  }

  const pct = (n: number) => `${n * 100}%`;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 28,
        borderRadius: 10,
        overflow: "hidden",
        background: "#e5e7eb", // neutral base for empty
      }}
    >
      {/* Segments container: each segment is flexible and contains fills */}
      <div style={{ display: "flex", height: "100%" }}>
        {boxes.map((box, idx) => (
          <div
            key={idx}
            style={{
              flex: 1,
              position: "relative",
              minWidth: 0,
              height: "100%",
            }}
          >
            {/* Team A fills, anchored to the segment's left edge */}
            {box.aConfirmed > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: pct(box.aConfirmed),
                  background: teamAColor,
                }}
              />
            )}
            {box.aPending > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: pct(box.aConfirmed),
                  top: 0,
                  bottom: 0,
                  width: pct(box.aPending),
                  background: teamAColor,
                  opacity: 0.55,
                }}
              />
            )}

            {/* Team B fills, anchored to the segment's right edge */}
            {box.bConfirmed > 0 && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: pct(box.bConfirmed),
                  background: teamBColor,
                }}
              />
            )}
            {box.bPending > 0 && (
              <div
                style={{
                  position: "absolute",
                  right: pct(box.bConfirmed),
                  top: 0,
                  bottom: 0,
                  width: pct(box.bPending),
                  background: teamBColor,
                  opacity: 0.55,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Vertical white separators between segments */}
      {Array.from({ length: boxCount - 1 }).map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${((i + 1) / boxCount) * 100}%`,
            width: 1,
            background: "var(--card-bg)",
            transform: "translateX(-0.5px)",
            zIndex: 2,
          }}
        />
      ))}

      {/* Midpoint marker (black) to indicate points needed to win */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          width: 2,
          background: "#000",
          transform: "translateX(-50%)",
          zIndex: 3,
        }}
      />
    </div>
  );
}
