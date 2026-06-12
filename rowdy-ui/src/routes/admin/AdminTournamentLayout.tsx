import { Outlet, useParams, Navigate } from "react-router-dom";
import { AdminTournamentProvider } from "../../contexts/AdminTournamentContext";

/**
 * Layout route for /admin/t/:tournamentId — loads the tournament, roster, and
 * rounds once and shares them with every nested admin page via context.
 */
export default function AdminTournamentLayout() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  if (!tournamentId) {
    return <Navigate to="/admin" replace />;
  }
  return (
    <AdminTournamentProvider key={tournamentId} tournamentId={tournamentId}>
      <Outlet />
    </AdminTournamentProvider>
  );
}
