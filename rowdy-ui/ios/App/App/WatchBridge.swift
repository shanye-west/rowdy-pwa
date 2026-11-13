import Foundation
import WatchConnectivity

/// Latest-value delivery, with an immediate path when both apps are reachable.
final class WatchBridge: NSObject, WCSessionDelegate {
    static let shared = WatchBridge()
    private let key = "rowdy.watch.v1"
    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }
    func save(_ data: Data) { UserDefaults.standard.set(data, forKey: key); advanceRevision(); publish() }
    func clear() { UserDefaults.standard.removeObject(forKey: key); advanceRevision(); publish() }
    private func advanceRevision() {
        let previous = UserDefaults.standard.double(forKey: "rowdy.watch.revision")
        UserDefaults.standard.set(max(previous + 1, Date().timeIntervalSince1970 * 1000), forKey: "rowdy.watch.revision")
    }
    private var payload: [String: Any] {
        if let data = UserDefaults.standard.data(forKey: key) { return ["snapshot": data, "revision": UserDefaults.standard.double(forKey: "rowdy.watch.revision")] }
        return ["clear": true, "revision": UserDefaults.standard.double(forKey: "rowdy.watch.revision")]
    }
    private func publish() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        do { try session.updateApplicationContext(payload) }
        catch { NSLog("Watch context delivery failed: %@", error.localizedDescription) }
        if session.isReachable { session.sendMessage(payload, replyHandler: nil, errorHandler: { _ in }) }
    }
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { self.publish() }
    }
    func sessionWatchStateDidChange(_ session: WCSession) { DispatchQueue.main.async { self.publish() } }
    func sessionReachabilityDidChange(_ session: WCSession) { DispatchQueue.main.async { self.publish() } }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async { replyHandler(self.payload) }
    }
}
