import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Layout from "../../components/Layout";
import StatusBanner from "../../components/admin/StatusBanner";
import MatchForm, { type MatchFormValues } from "../../components/admin/MatchForm";
import { useAdminTournament } from "../../contexts/AdminTournamentContext";
import { adminApi } from "../../api/admin";
import { getErrorMessage } from "../../api/errors";
import { localInputToIso } from "../../utils/teeTime";
import type { SeedMatchRequest } from "../../api/adminContracts";

/** Create a match inside a known tournament + round — no selectors needed. */
export default function MatchCreate() {
  const navigate = useNavigate();
  const { roundId = "" } = useParams<{ roundId: string }>();
  const { tournamentId, tournament, players, rounds, loading } = useAdminTournament();
  const round = rounds.find((r) => r.id === roundId);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: MatchFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      if (values.teamAPlayers.length === 0 || values.teamBPlayers.length === 0) {
        throw new Error("Each team must have at least one player");
      }
      const payload: SeedMatchRequest = {
        id: values.matchId,
        tournamentId,
        roundId,
        teamAPlayers: values.teamAPlayers.map((p) => ({ playerId: p.playerId })),
        teamBPlayers: values.teamBPlayers.map((p) => ({ playerId: p.playerId })),
      };
      if (values.teeTime) {
        payload.teeTime = localInputToIso(values.teeTime);
      }
      await adminApi.seedMatch(payload);
      navigate(`/admin/t/${tournamentId}/match/${values.matchId}`, { replace: true });
    } catch (err) {
      console.error("Error creating match:", err);
      setError(getErrorMessage(err, "Failed to create match"));
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout title="Add Match" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  if (!tournament || !round) {
    return (
      <Layout title="Add Match" showBack>
        <div className="p-4 space-y-4">
          <StatusBanner error={!tournament ? "Tournament not found" : "Round not found"} />
          <Link to={`/admin/t/${tournamentId}`} className="btn btn-secondary">Back to Tournament</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={`Add Match — Day ${round.day}`} showBack>
      <div className="p-4 max-w-2xl mx-auto space-y-4">
        <StatusBanner error={error} />
        <div className="text-sm text-gray-600">
          {tournament.year} {tournament.name} · Day {round.day} · {round.format || "Format TBD"}.
          Strokes are calculated from the tournament handicaps and the round's course.
        </div>
        <MatchForm
          tournament={tournament}
          players={players}
          submitting={submitting}
          submitLabel="Create Match"
          onSubmit={handleSubmit}
        />
      </div>
    </Layout>
  );
}
