import XCTest

final class RowdyStoreTests: XCTestCase {
    let suite = "RowdyNativeTests.isolated"
    override func setUp() {
        RowdyStore.defaults = UserDefaults(suiteName: suite)!
        RowdyStore.defaults.removePersistentDomain(forName: suite)
    }
    override func tearDown() {
        RowdyStore.defaults.removePersistentDomain(forName: suite)
        RowdyStore.defaults = .standard
    }
    let saved = RowdySnapshot(tournamentId: "test", tournamentName: "Test only", teamA: "A", teamB: "B", pointsA: 2.5, pointsB: 1, updatedAt: 1700000000000)
    func testMissingAndPersistedSnapshot() {
        XCTAssertNil(RowdyStore.snapshot)
        XCTAssertTrue(RowdyStore.setContext("user:test"))
        RowdyStore.snapshot = saved
        // Re-open the same private defaults suite, as on app relaunch.
        RowdyStore.defaults = UserDefaults(suiteName: suite)!
        XCTAssertEqual(RowdyStore.snapshot, saved)
        XCTAssertEqual(RowdyStore.snapshot?.updatedAt, 1700000000000)
        XCTAssertFalse(RowdyStore.setContext("user:test"))
        XCTAssertEqual(RowdyStore.snapshot, saved)
    }
    func testLogoutClearsSnapshot() {
        _ = RowdyStore.setContext("user:test"); RowdyStore.snapshot = saved
        XCTAssertTrue(RowdyStore.setContext(""))
        XCTAssertNil(RowdyStore.snapshot)
    }
    func testAccountAndTournamentSwitchClearUntilFreshSave() {
        _ = RowdyStore.setContext("user:test"); RowdyStore.snapshot = saved
        XCTAssertTrue(RowdyStore.setContext("user:other"))
        XCTAssertNil(RowdyStore.snapshot)
        RowdyStore.snapshot = saved
        XCTAssertTrue(RowdyStore.setContext("other-user:other"))
        XCTAssertNil(RowdyStore.snapshot)
    }
}
