import Foundation
import ActivityKit

// Main-app private storage: also accessible to App Intents running in this target.
enum RowdyStore {
    static var defaults = UserDefaults.standard
    static let key = "rowdy.standings.v1"
    static var snapshot: RowdySnapshot? {
        get { defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(RowdySnapshot.self, from: $0) } }
        set {
            if let value = newValue, let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
            else { defaults.removeObject(forKey: key) }
        }
    }
    static func setContext(_ context: String) -> Bool {
        guard context.isEmpty || defaults.string(forKey: "rowdy.context") != context else { return false }
        snapshot = nil
        defaults.set(context, forKey: "rowdy.context")
        return true
    }
    static func end() async {
        for activity in Activity<RowdyAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}

