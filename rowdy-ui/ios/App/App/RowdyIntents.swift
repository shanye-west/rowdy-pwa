import AppIntents
import Foundation

struct CheckStandingsIntent: AppIntent {
    static var title: LocalizedStringResource = "Check standings"
    static var description = IntentDescription("Read Rowdy Test’s last saved confirmed Cup points.")
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let s = RowdyStore.snapshot else {
            return .result(dialog: "Open Rowdy Test and load the Cup standings first.")
        }
        let time = s.date.formatted(date: .abbreviated, time: .shortened)
        let a = s.pointsA.formatted(); let b = s.pointsB.formatted()
        return .result(dialog: "Last saved standings for \(s.tournamentName), updated \(time): \(s.teamA), \(a) points. \(s.teamB), \(b) points. These are saved standings, not a live update.")
    }
}
struct OpenStandingsIntent: AppIntent {
    static var title: LocalizedStringResource = "Open standings"
    static var openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: "rowdy.openStandings")
        NotificationCenter.default.post(name: Notification.Name("RowdyOpenStandings"), object: nil)
        return .result()
    }
}
struct RowdyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CheckStandingsIntent(), phrases: ["Check standings in \(.applicationName)"], shortTitle: "Check standings", systemImageName: "flag.checkered")
        AppShortcut(intent: OpenStandingsIntent(), phrases: ["Open standings in \(.applicationName)"], shortTitle: "Open standings", systemImageName: "sportscourt")
    }
}
