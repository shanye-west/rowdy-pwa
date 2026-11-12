import ActivityKit
import Foundation

struct RowdySnapshot: Codable, Hashable {
    let tournamentId: String
    let tournamentName: String
    let teamA: String
    let teamB: String
    let pointsA: Double
    let pointsB: Double
    let updatedAt: Double
    var date: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}
struct RowdyAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable { let snapshot: RowdySnapshot }
    let tournamentId: String
}
