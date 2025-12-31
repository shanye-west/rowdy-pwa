import Layout from "../components/Layout";
import { Card, CardContent } from "../components/ui/card";
import { useTournamentContext } from "../contexts/TournamentContext";

export default function Player() {
  const { tournament } = useTournamentContext();

  return (
    <Layout
      title="Player Profile"
      series={tournament?.series}
      showBack
      tournamentLogo={tournament?.tournamentLogo}
    >
      <div className="px-4 py-10">
        <Card className="mx-auto max-w-md border-slate-200/80 bg-white/90 text-center">
          <CardContent className="py-8">
            <div className="text-lg font-semibold text-slate-900">Player Bio - Coming Soon</div>
                        <div className="text-lg font-semibold text-slate-900">Eat a Dick, Dugan</div>

          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
