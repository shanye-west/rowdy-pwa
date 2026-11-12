import Capacitor
import ActivityKit
import UIKit

@objc(RowdyNativePlugin)
public class RowdyNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RowdyNativePlugin"
    public let jsName = "RowdyNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takeOpenStandings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setContext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise)
    ]
    private var navigationObserver: NSObjectProtocol?
    public override func load() {
        navigationObserver = NotificationCenter.default.addObserver(forName: Notification.Name("RowdyOpenStandings"), object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("openStandings", data: [:], retainUntilConsumed: true)
        }
    }
    deinit { if let observer = navigationObserver { NotificationCenter.default.removeObserver(observer) } }
    @objc func takeOpenStandings(_ call: CAPPluginCall) {
        let open = UserDefaults.standard.bool(forKey: "rowdy.openStandings")
        UserDefaults.standard.removeObject(forKey: "rowdy.openStandings")
        call.resolve(["open": open])
    }
    @objc func setContext(_ call: CAPPluginCall) {
        guard let context = call.getString("context") else { call.reject("Missing context"); return }
        Task { @MainActor in
            if RowdyStore.setContext(context) {
                await RowdyStore.end()
            }
            call.resolve()
        }
    }
    @objc func save(_ call: CAPPluginCall) {
        guard let context = call.getString("context"), !context.isEmpty,
              let object = call.getObject("snapshot"),
              let bytes = try? JSONSerialization.data(withJSONObject: object),
              let snapshot = try? JSONDecoder().decode(RowdySnapshot.self, from: bytes),
              snapshot.updatedAt.isFinite, snapshot.updatedAt > 0,
              snapshot.pointsA.isFinite, snapshot.pointsB.isFinite else { call.reject("Invalid standings"); return }
        Task { @MainActor in
            guard UserDefaults.standard.string(forKey: "rowdy.context") == context else { call.reject("Tournament or account changed"); return }
            RowdyStore.snapshot = snapshot
            for activity in Activity<RowdyAttributes>.activities {
                if activity.attributes.tournamentId == snapshot.tournamentId {
                    await activity.update(ActivityContent(state: RowdyAttributes.ContentState(snapshot: snapshot), staleDate: snapshot.date.addingTimeInterval(300)))
                } else { await activity.end(nil, dismissalPolicy: .immediate) }
            }
            call.resolve()
        }
    }
    @objc func read(_ call: CAPPluginCall) {
        var result: JSObject = ["active": !Activity<RowdyAttributes>.activities.isEmpty, "snapshot": NSNull()]
        if let snapshot = RowdyStore.snapshot {
            // Build JS values explicitly: Foundation's JSON object can contain
            // NSString values that fail a cast to Capacitor's JSValue protocol.
            let value: JSObject = [
                "tournamentId": snapshot.tournamentId,
                "tournamentName": snapshot.tournamentName,
                "teamA": snapshot.teamA, "teamB": snapshot.teamB,
                "pointsA": snapshot.pointsA, "pointsB": snapshot.pointsB,
                "updatedAt": snapshot.updatedAt
            ]
            result["snapshot"] = value
        }
        call.resolve(result)
    }
    @objc func start(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.reject("Live Activities are disabled in iPhone settings."); return }
            guard let snapshot = RowdyStore.snapshot else { call.reject("Open Rowdy standings online first."); return }
            await RowdyStore.end()
            do {
                _ = try Activity.request(attributes: RowdyAttributes(tournamentId: snapshot.tournamentId), content: ActivityContent(state: RowdyAttributes.ContentState(snapshot: snapshot), staleDate: snapshot.date.addingTimeInterval(300)), pushType: nil)
                call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func end(_ call: CAPPluginCall) { Task { await RowdyStore.end(); call.resolve() } }
    @objc func openExternal(_ call: CAPPluginCall) {
        guard let value = call.getString("url"), let url = URL(string: value),
              ["https", "http", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else { call.reject("Unsupported URL"); return }
        Task { @MainActor in
            let ok = await UIApplication.shared.open(url, options: [:])
            if ok { call.resolve() } else { call.reject("Unable to open browser") }
        }
    }
}

class RowdyViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        webView?.allowsBackForwardNavigationGestures = true
        bridge?.registerPluginInstance(RowdyNativePlugin())
    }
}
