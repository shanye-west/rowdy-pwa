import Layout from "../components/Layout";
import CommentThread from "../components/CommentThread";
import { useTournamentContext } from "../contexts/TournamentContext";

/**
 * Standalone trash-talk chat — the tournament-wide "sportsbook" comment feed,
 * promoted out of the Sportsbook tabs into its own bottom-nav destination.
 * Gated on `commentsEnabled` (mirrors the old Chat tab in Sportsbook).
 */
export default function Chat() {
  const { tournament } = useTournamentContext();

  if (!tournament) {
    return (
      <Layout title="Chat" showBack>
        <div className="empty-state">
          <div className="empty-state-icon">💬</div>
          <div className="empty-state-text">No active tournament.</div>
        </div>
      </Layout>
    );
  }

  if (!tournament.commentsEnabled) {
    return (
      <Layout title="Chat" series={tournament.series} showBack tournamentLogo={tournament.tournamentLogo}>
        <div className="empty-state">
          <div className="empty-state-icon">💬</div>
          <div className="empty-state-text">Chat isn't open for this tournament yet.</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Chat" series={tournament.series} showBack tournamentLogo={tournament.tournamentLogo}>
      <div className="p-4">
        <CommentThread
          threadType="sportsbook"
          threadId={`sb_${tournament.id}`}
          tournamentId={tournament.id}
          title="Trash talk"
        />
      </div>
    </Layout>
  );
}
