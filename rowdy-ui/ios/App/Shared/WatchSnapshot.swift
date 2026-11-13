import Foundation
struct WatchSnapshot: Codable {
    struct Standings: Codable {
        let tournamentId, tournamentName, teamA, teamB: String
        let pointsA, pointsB, updatedAt: Double
        var date: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
    }
    struct Match: Codable, Identifiable { let id, title, status: String }
    let standings: Standings
    let matches: [Match]
}
