import ActivityKit
import WidgetKit
import SwiftUI

struct StandingsView: View {
    let snapshot: RowdySnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(snapshot.tournamentName).font(.headline).lineLimit(1)
            HStack {
                Text(snapshot.teamA).lineLimit(1)
                Spacer()
                Text(snapshot.pointsA, format: .number).bold()
                Text("–")
                Text(snapshot.pointsB, format: .number).bold()
                Spacer()
                Text(snapshot.teamB).lineLimit(1)
            }
            Text("Last saved \(snapshot.date.formatted(date: .abbreviated, time: .shortened))").font(.caption)
        }.padding()
    }
}
@main
struct RowdyLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RowdyAttributes.self) { context in
            StandingsView(snapshot: context.state.snapshot)
                .activityBackgroundTint(Color(red: 0.04, green: 0.15, blue: 0.27))
                .activitySystemActionForegroundColor(.white)
                .foregroundStyle(.white)
                .widgetURL(URL(string: "rowdytest://standings"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) { StandingsView(snapshot: context.state.snapshot) }
            } compactLeading: {
                Text(context.state.snapshot.pointsA, format: .number)
            } compactTrailing: {
                Text(context.state.snapshot.pointsB, format: .number)
            } minimal: {
                Text("\(context.state.snapshot.pointsA.formatted())–\(context.state.snapshot.pointsB.formatted())").font(.caption2)
            }.widgetURL(URL(string: "rowdytest://standings"))
        }
    }
}
