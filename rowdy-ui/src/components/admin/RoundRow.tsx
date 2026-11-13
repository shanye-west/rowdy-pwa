import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import IndexTile from "./IndexTile";
import NavRow from "./NavRow";
import { Badge } from "../ui/badge";
import { formatRoundType } from "../../utils";
import type { RoundDoc } from "../../types";

/** One Cup round in an admin list — the same row on the dashboard and the tournament page. */
export default function RoundRow({
  tournamentId,
  round,
  trailing,
}: {
  tournamentId: string;
  round: RoundDoc;
  /** Controls outside the link, e.g. the lock switch. */
  trailing?: ReactNode;
}) {
  const matchCount = round.matchIds?.length ?? 0;
  return (
    <NavRow
      to={`/admin/t/${tournamentId}/round/${round.id}`}
      leading={<IndexTile label="Day" value={round.day ?? "?"} />}
      title={formatRoundType(round.format)}
      subtitle={`${matchCount} match${matchCount === 1 ? "" : "es"} · ${round.pointsValue ?? 1} pt each`}
      badges={
        round.locked ? (
          <Badge variant="muted" className="gap-1">
            <Lock className="h-3 w-3" />
            locked
          </Badge>
        ) : null
      }
      trailing={trailing}
    />
  );
}
