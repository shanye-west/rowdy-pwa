import SwiftUI
import WatchConnectivity

final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var snapshot: WatchSnapshot?
    @Published var message = "Open Rowdy Test on your iPhone to update."
    private let key = "rowdy.watch.v1"
    override init() {
        super.init()
        if let data = UserDefaults.standard.data(forKey: key) { snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }
    private func receive(_ payload: [String: Any]) {
        DispatchQueue.main.async {
            guard let revision = payload["revision"] as? Double,
                  revision >= UserDefaults.standard.double(forKey: "rowdy.watch.revision") else { return }
            UserDefaults.standard.set(revision, forKey: "rowdy.watch.revision")
            if payload["clear"] as? Bool == true {
                self.snapshot = nil
                UserDefaults.standard.removeObject(forKey: self.key)
                self.message = "Sign in and open a tournament on your iPhone."
            } else if let data = payload["snapshot"] as? Data,
                      let snapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) {
                self.snapshot = snapshot
                UserDefaults.standard.set(data, forKey: self.key)
                self.message = "Last saved on iPhone. Open Rowdy Test there for fresh scores."
            }
        }
    }
    func refresh() {
        guard WCSession.default.activationState == .activated, WCSession.default.isReachable else {
            message = snapshot == nil ? "Open Rowdy Test on your iPhone to send standings." : "iPhone unavailable. Showing last saved data."; return
        }
        message = "Requesting saved standings…"
        WCSession.default.sendMessage(["refresh": true], replyHandler: { self.receive($0) }, errorHandler: { _ in
            DispatchQueue.main.async { self.message = "Could not reach iPhone. Try opening Rowdy Test." }
        })
    }
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        receive(session.receivedApplicationContext)
        DispatchQueue.main.async { self.refresh() }
    }
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) { receive(applicationContext) }
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { receive(message) }
}

@main
struct RowdyWatchApp: App {
    @StateObject private var model = WatchModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                List {
                    if let snapshot = model.snapshot {
                        Section(snapshot.standings.tournamentName) {
                            total(snapshot.standings.teamA, fallback: "Team A", points: snapshot.standings.pointsA, color: .blue)
                            total(snapshot.standings.teamB, fallback: "Team B", points: snapshot.standings.pointsB, color: .orange)
                            VStack(alignment: .leading) {
                                Text("Last saved").font(.caption2)
                                Text(snapshot.standings.date, format: .dateTime.month(.abbreviated).day().hour().minute()).font(.caption2)
                            }.foregroundStyle(.secondary)
                        }
                        Section("Cup matches") {
                            if snapshot.matches.isEmpty { Text("No Cup matches scheduled yet.").font(.caption) }
                            ForEach(snapshot.matches) { match in
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(match.title).font(.caption2).foregroundStyle(.secondary)
                                    Text(match.status).font(.headline)
                                }.accessibilityElement(children: .combine)
                            }
                        }
                    } else {
                        Text("No saved standings").font(.headline)
                    }
                    Section {
                        Text(model.message).font(.caption2)
                        Button("Refresh from iPhone") { model.refresh() }
                    }
                }.navigationTitle("Rowdy Test")
            }.onChange(of: scenePhase) { _, phase in if phase == .active { model.refresh() } }
        }
    }
    private func total(_ name: String, fallback: String, points: Double, color: Color) -> some View {
        HStack {
            Text(name.isEmpty ? fallback : name).font(.headline)
            Spacer()
            Text(points, format: .number).font(.title2.bold()).foregroundStyle(color)
        }.accessibilityElement(children: .combine)
    }
}
