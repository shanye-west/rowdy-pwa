# Rowdy Test — personal iPhone prototype

Rowdy Test bundles the React app locally with Capacitor 8. The app and its Live Activity extension target iOS 18+. Production Firebase (`rowdy-pwa`) remains the backend; a native install has its own login and Firestore cache. No hosting or backend deployment is needed.

## Build and install

Use Node 22 or newer (Capacitor 8 requires it), full Xcode, and an installed iOS runtime. Xcode and the iOS 27.2 simulator are available on this Mac. If command-line tools still point to the standalone tools, use `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` for Xcode commands, or select Xcode in Xcode Settings → Locations.

From `rowdy-ui` (on this Mac Node 20 was initially selected; use Node 22 first):

```sh
# Temporary Node 22 shell for the complete workflow if your PATH still has Node 20:
npx --yes --package=node@22 --package=npm@10 -c 'npm run native:sync'
```

With Node 22 selected:

```sh
npm ci
npm run native:sync   # typecheck, build dist-native, copy into iOS, sync SPM
npm run native:open
```

`npm run build` still produces the web/PWA in `dist`. `native:sync` never deploys Firebase. The sync hook repairs Capacitor's generated SPM `.v18` spelling to the Swift-tools-5.9-compatible `.iOS("18.0")`.

In Xcode:

1. Add your Apple Account in Settings → Accounts. Select your **Personal Team**; do not enroll in a paid program.
2. Select the **App** target → Signing & Capabilities → Automatically manage signing → your Personal Team. Repeat for **RowdyLiveActivity**. Identifiers are `com.rowdycup.app.prototype` and `com.rowdycup.app.prototype.liveactivity`.
3. Connect and unlock your iPhone, trust the Mac, and enable Settings → Privacy & Security → Developer Mode (restart/confirm if prompted).
4. Select scheme **App**, choose your iPhone as destination, and Run. Complete any device trust/developer-profile prompt.
5. Validate signing of both targets first. If Xcode refuses a capability, save its exact error for diagnosis; do not add paid capabilities or enroll to get past it.

This project does not request App Groups, APNs, SiriKit entitlements, or remote Live Activity push. App Intents are compiled into the main app; local ActivityKit support is enabled with `NSSupportsLiveActivities`. Apple successfully generated Personal Team provisioning profiles for both targets on this Mac. The signed app and extension built successfully and installed on the connected iPhone. iOS developer-profile trust and runtime acceptance remain user steps.

Apple's free provisioning expires after seven days. Reconnect the phone and Run from Xcode again to renew it. Keep the same bundle IDs; avoid deleting the app so its login/cache can remain. Never commit Apple credentials, provisioning profiles, certificates, personal team selections, or `xcuserdata`. Your selected team is stored in ignored `ios/Signing.local.xcconfig`, included by the project configuration. If Xcode writes `DEVELOPMENT_TEAM` directly into the project again, move it to that local file before committing.

Apple references: [Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account), [Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), [Live Activity configuration](https://developer.apple.com/documentation/bundleresources/information-property-list/nssupportsliveactivities).

## Try the native features

Sign in normally. Use the **Native Preview** link above the page content. It shows the saved Cup standings and timestamp. These are confirmed Cup points from `useTournamentData`, not pending points, side-event scores, or captains' match results.

Say “Check standings in Rowdy Test” for the last saved totals and time. “Open standings in Rowdy Test” opens the home screen. Both actions also appear in Shortcuts. Siri recognition must be verified on the phone with Siri enabled.

Start Live Activity explicitly from Native Preview. It shows the tournament, team totals, and saved timestamp on the Lock Screen and expanded Dynamic Island (where supported). Compact/minimal layouts show totals. Start replaces any existing Rowdy activity; End removes it. iOS marks content stale after five minutes. The timestamp remains visible: the prototype updates only while the app runs, not through server push while suspended.

The native coordinator reuses the existing Cup-total hook across home and the preview. Only server-confirmed Firestore snapshots without pending writes can replace the saved snapshot. Offline/cache reads keep the previously persisted timestamp. Logging out or switching accounts/tournaments clears private native storage and ends the activity before new standings are saved. Reopening the same account/tournament retains the saved snapshot. A new tournament with no Cup rounds has zero confirmed points.

## Web/native behavior

- Native: no service-worker registration, web update reloads, install prompts, web push registration, web badge calls, or browser-device reporting. The native output excludes the web messaging worker and install tutorial videos.
- In-app notifications and category preferences remain. Native system push is explicitly unavailable; its admin test button is hidden.
- Login, authorization, scoring, listeners, and IndexedDB offline persistence use the existing Firebase client. No scoring or security rules changed.
- External links open via iOS in the system handler. Internal routes remain in the WebView. Rules Official opens `https://app.rowdycup.com/rules-official` in the browser with its own session and production App Check. No debug bypass exists.
- Build artifacts, copied web assets, DerivedData, and personal Xcode state are ignored. Swift source, artwork, project configuration, and the SPM lockfile belong in Git.

## Validation checklist

Automated checks: `npm run build`, `npm run build:native`, `npm run test:run`, `npm run lint`. The native policy tests cover confirmed totals, stale/cache timestamps, missing data, switch races, and serialized save/clear ordering.

Simulator build without signing:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator \
  -configuration Debug -derivedDataPath /tmp/rowdy-native-derived \
  CODE_SIGNING_ALLOWED=NO build
```

Before calling the prototype accepted, verify on the physical iPhone:

- Personal Team signing works for both app and extension.
- Email/password login persists after relaunch; normal account permissions apply.
- Safe areas, keyboard, modals, back navigation, scorecard scrolling, and external links work.
- Siri reads last-saved standings/time, handles no snapshot, and opens home from another route.
- Start/update/end work on the Lock Screen/Dynamic Island; no duplicate activity after relaunch.
- Airplane mode preserves the snapshot's old timestamp; logout and tournament switches clear it and end the activity.
- Rules Official opens in the browser; native never attempts its App Check-protected callable.

Do score writes and offline replay against Firebase emulators first, with an explicitly isolated emulator configuration. This implementation has not changed the production Firebase configuration to route to emulators. **Any score entered against the normal installed app is real production data.** Do not use fake production scoring to exercise the Live Activity. Existing live reads, real authorized score entry, and isolated test fixtures are the appropriate paths.

## Validation results

- Web and native TypeScript/Vite builds passed; web emitted `sw.js`/Workbox, native emitted neither a service worker nor a manifest.
- 267 frontend tests passed; targeted lint of the new native TypeScript/config files passed. Full repository lint still reports existing errors in unrelated and previously existing code.
- Xcode simulator compilation succeeded for both App and RowdyLiveActivity. The app installed and launched in the iPhone simulator.
- Three Swift storage tests passed in an isolated simulator test bundle: persistence/missing data, logout clearing, account/tournament switching. Test fixtures never touch Firebase.
- Simulator inspection in Xcode Device Hub verified the header/bottom safe areas, native preview navigation, signed-out state, and live production tournament reads. Native Firebase uses email/password-only auth initialization and forced long-polling after the initial WebView connection stalled. Physical layout, login persistence, Siri voice recognition, Live Activity visibility, and runtime behavior remain to be verified with the user. Personal Team provisioning, signed build, code-signature verification, and device installation passed.
- No production score writes or deployment were performed. Score mutation/offline replay acceptance remains pending emulator testing.

## Haptics and Apple Watch companion

The iPhone uses UIKit feedback for score-picker selections and the existing
`useDebouncedSave` outcomes: success only after server acknowledgment, a soft
impact for queued writes, and notification error feedback for rejection. Native
Preview has four safe test buttons; these do not write tournament data. Web
builds retain browser vibration where supported. Haptic failure never blocks a
save, and feedback is not triggered by background score listeners.

`RowdyWatch` is a read-only SwiftUI watchOS 11+ companion, bundle identifier
`com.rowdycup.app.prototype.watchkitapp`. It is embedded in the iPhone app and
uses the same local Personal Team signing configuration. The `RowdyWatch`
Xcode scheme can run directly on a paired Watch or watchOS simulator. For a
physical Watch, keep it unlocked near the iPhone, enable Developer Mode if
requested, and use the iPhone Watch app's Available Apps list to install
Rowdy Test. Provisioning/device registration may require running the Watch
scheme in Xcode. Renew the free provisioning by rebuilding and reinstalling,
just as for the iPhone app.

The Watch shows confirmed Cup totals and all scheduled Cup match statuses
(including final results), using existing server-computed fields. Captains'
season and side events are separate from Cup matches and are not included.
The native provider requests the shared hook's full match data instead of its
denormalized-totals optimization; the web remains unchanged. Only
server-confirmed snapshots with no pending writes are forwarded. No scoring
math or Firebase authentication is implemented on the Watch.

WatchConnectivity sends the latest snapshot via application context and sends
an immediate message when reachable. A revision number prevents an older
queued context from overwriting a newer message. The Watch persists the last
received snapshot and displays its original saved timestamp. Refresh from
Watch requests the phone's saved snapshot, not a fresh Firebase fetch. Keep the
iPhone app running for fresh data; this is not standalone/background live
scoring. Logout/account/tournament changes enqueue a clear; an unreachable
Watch retains its previously saved display until delivery is possible.

Validation: web/native frontend builds and frontend tests, signed iPhone/Watch
builds, and watchOS simulator layouts. The iPhone build with embedded Watch
companion was installed. Physical Watch installation, connectivity and haptic
feel require device confirmation; no production score entries were made.

Apple reference: [Transferring data with Watch Connectivity](https://developer.apple.com/documentation/watchconnectivity/transferring-data-with-watch-connectivity).
