**Rowdy Cup security review — November 11, 2026**

Initial recommendation: fix the access-control findings below before promoting the production app on LinkedIn. The email/scouting-note migration was working in production, but public account creation was still enabled at the time of the audit. This review does not certify the absence of vulnerabilities.

**Remediation update — November 11, 2026:** public account creation is now disabled in production project `rowdy-pwa` using `client.permissions.disabledUserSignup: true`. The setting was read back successfully; all other returned authentication configuration fields, including existing email/password sign-in, were unchanged. Direct anonymous and email/password `accounts:signUp` requests both returned HTTP 400 `ADMIN_ONLY_OPERATION`; neither created an account. Administrator provisioning remains the onboarding path. This closes the new-account registration path in finding 1. Existing accounts were not disabled or revoked, and the broader membership-based read-rule recommendation remains open. No hosting or Functions deployment was needed. The findings and validation below describe the initial audit unless explicitly updated here.

Initial audit scope: repository source, all callable entry points and shared authorization guards, Firestore/Storage rules, dependency lockfiles, frontend authentication/rendering/caching, public production reads, read-only Firebase configuration inspection, and isolated Firestore emulator checks. During the initial audit, no production documents, accounts, settings, or deployments were changed, and no production sign-up, password attempt, malicious write, or load test was performed.

**1. High — self-registration defeats the private-group read boundary**

Evidence: `firestore.rules:253`, `:261`, `:273`, `:277`, and `:298` allow bets, settlements, comments/replies, and live drafts to any authenticated Firebase account. They do not require an approved player. `rowdy-ui/src/components/RequireAuth.tsx:35` also checks the Firebase user rather than the player.

Production configuration inspection found email/password sign-in enabled, anonymous authentication enabled, no configured sign-up blocking function, and no `disabledUserSignup: true` restriction. App Check enforcement for Authentication and Firestore is `UNENFORCED`. Google documents both the default availability of end-user registration and the configuration needed to disable it: [user management](https://docs.cloud.google.com/identity-platform/docs/concepts-manage-users), [ClientPermissions](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config).

The deployed Firestore rules match the local file exactly. With those rules in an isolated emulator, an authenticated UID with **no player document** successfully read synthetic bets, settlements, comments, replies, and a live draft. An anonymous-auth UID also read chat. A completely signed-out request was denied, which explains why checking only incognito browsing misses this issue.

Impact: a visitor can obtain an account through Firebase's API and satisfy the private-read rule without being invited or linked. This finding concerns private reads; `requirePlayer` and `requireAdmin` still block unlinked users from the corresponding mutations/admin operations.

Remediation: enforce approved membership in the read rules using a server-managed UID-keyed membership document or custom claim. Populate it for legitimate accounts before deploying the restrictive rule, and remove membership on unlink/revocation. Disable end-user registration at the provider configuration if accounts are exclusively administrator-created; review the need for anonymous auth. Audit existing unlinked accounts, since disabling new sign-ups does not revoke existing access. Mirror membership in the route guard for UX, but keep the backend authoritative. App Check is additional abuse protection, not a substitute for membership.

**2. High — six production test matches permit signed-out score edits**

**Remediated active exposure — November 11, 2026:** set `_TestRowdyCup2026.openPublicEdits` to false in production with a field-only update and a document-version precondition. Read-back confirmed the flag is false and all other tournament fields were unchanged. All nine production tournaments were checked; none still enables public editing. Updated `scripts/setup-test-auth-2026.js` to keep the flag false and removed the README's public-edit enablement instructions. The admin toggle and rule exception still exist, so deliberately re-enabling this flag would restore public access; removing that legacy feature entirely remains optional further hardening. No score documents were changed and no deployment was required.

Remediation validation: four isolated emulator assertions confirmed signed-out and unlinked-user score updates are denied, an authorized rostered scorer can still update an unlocked match, and a locked match rejects that scorer. The setup script passed `node --check`; the frontend production build passed. The setup script itself was not executed against production.

Evidence: `firestore.rules:89` and `:119` let `isTournamentOpen()` independently authorize a write. That branch does not require authentication. Production tournament `_TestRowdyCup2026` has `openPublicEdits: true`; all six queried matches in it are unlocked. The other eight tournament documents inspected do not have the flag enabled.

The emulator accepted a signed-out score update for an unlocked match in an open tournament and rejected the equivalent update for a normal tournament. No production write was attempted.

Impact: arbitrary visitors can tamper with those test scores and cause production scoring/statistics/notification trigger work. The directly editable documents found belong to the test tournament, not the real event tournaments. Hiding test tournaments from navigation does not restrict API access.

Remediation: set this flag false for the affected production tournament. Remove the public-write escape hatch from production rules or replace it with an explicit approved-tester policy. `scripts/setup-test-auth-2026.js:251` re-enables the flag and must also be retired or updated. Its comment incorrectly describes the setting as requiring a logged-in test user.

**3. High if seed credentials remain valid — enabled test accounts share the production trust boundary**

Evidence: `scripts/setup-test-auth-2026.js:26` contains a fixed shared password used to create test accounts. Production lookup found all 24 linked test accounts still present, enabled, and using the password provider. None of their public player documents has `isAdmin: true`. The current passwords were not tested, so this review does not claim that the seed password still works.

`functions/src/helpers/adminAuth.ts:70` accepts any linked player, including a test player. A test account can therefore satisfy group-level player authorization, rather than being confined to the test tournament. For example, comment posting validates the target tournament/thread but does not require the author's membership in that tournament. The paid rules endpoint also uses `requirePlayer` (`functions/src/rulesOfficial/askRulesOfficial.ts:252`) and App Check, not an admin check.

Remediation: disable unused production test accounts and revoke sessions; rotate credentials for any intentionally retained account. Remove the shared password from the seeding workflow. Prefer emulator-only accounts. If production test players must remain, explicitly restrict them from real group data and operations. Do not assume removing a password from the current source revokes credentials already issued.

**4. Medium — older linking scripts can reintroduce public emails**

**Remediated — November 11, 2026:** updated all three identified scripts to write email only to `players/{id}/private/profile` and delete any legacy public `email` field in the same atomic batch/REST commit. Private profile writes merge the email field so existing scouting notes survive. Added six emulator-only regression tests covering the actual script workflows, including all 24 synthetic players in the REST setup, repeated linking, new private profiles, and a failed commit leaving private data unchanged. All six tests passed, as did strict targeted TypeScript checks for both changed TypeScript scripts and JavaScript syntax checks. The full scripts typecheck remains blocked by four unchanged utilities importing the absent `service-account.json`; no credential file was created. A fresh signed-out production read checked all 66 public players and found no email/scouting-note fields, so no production cleanup or deployment was necessary. The provisioning scripts were not run against production.

Evidence: `scripts/link-auth-to-player.ts:45`, `scripts/bulk-link-auth.ts:76`, and `scripts/setup-test-auth-2026.js:243` still write `email` onto `players/{id}`. These use privileged writes that bypass Firestore rules. `scripts/README.md` still recommends the older linking scripts.

Current production check: all 66 public player documents were inspected; none contains `email`, `scoutingNotes`, `phone`, `address`, or `password`. This is a regression path, not a currently observed email leak.

Remediation: move every writer to `players/{id}/private/profile`, preferably with a batch that also removes any legacy public fields. Retire obsolete scripts or route onboarding through the corrected admin callable. Add a regression check covering all supported player writers. Firestore rules cannot hide selected fields of an otherwise public document: [Firebase field-access guidance](https://firebase.google.com/docs/firestore/security/rules-fields).

**5. Medium — changing a player's account does not revoke copied match access**

Evidence: `functions/src/callables/adminOps.ts:769` updates the player mapping but does not refresh existing `authorizedUids`. Match and side-event rules trust the copied UID arrays (`firestore.rules:83`, `:160`). Private drafts/plans also use copied authorization arrays.

In the emulator, after changing a player's `authUid` from an old account to its replacement, the old UID could still update a match that retained it in `authorizedUids`. This is conditional on relinking/revoking access; it is not evidence that a particular production account is currently exploiting stale access.

Remediation: make account replacement a complete revocation operation: refresh affected authorization documents, remove old membership, and disable/revoke the old account when appropriate. A live membership check in rules can provide an immediate revocation boundary while denormalized documents are updated. Preserve legitimate offline score-entry behavior in tests.

**6. Dependency remediation required — known advisories remain in the lockfiles**

`npm audit --json` and `npm audit --omit=dev --json` returned the following package-level totals. Counts include transitive packages and overlapping advisory chains; they are not counts of demonstrated application exploits.

| Package tree | All dependencies | All: high / critical | Excluding dev dependencies | Excluding dev: high / critical |
| --- | ---: | ---: | ---: | ---: |
| Frontend | 34 | 20 / 3 | 6 | 3 / 2 |
| Functions | 42 | 24 / 5 | 24 | 9 / 4 |
| Admin scripts | 19 | 5 / 3 | 18 | 5 / 3 |

Examples include React Router 7.9.6, protobufjs 7.5.4, Vitest 4.0.14, and server transitive HTTP/parsing/crypto packages. The upstream advisories describe distinct prerequisites: [React Router redirects](https://github.com/remix-run/react-router/security/advisories/GHSA-2w69-qvjg-hvjx), [protobuf schema code generation](https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-66ff-xgx4-vchm), and [Vitest UI server exposure](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp).

Applicability matters: this frontend is a static SPA, so SSR/RSC-specific advisories do not establish a remotely reachable server exploit here. Some Firebase Node dependencies in the frontend package tree are not necessarily bundled for browsers. The production site does not serve the Vitest UI. No attacker-controlled protobuf schema path was identified. The Firebase public API key is expected client configuration, not a private credential.

Remediation: update supported direct dependencies and their transitive lockfile resolutions, then re-run builds, tests, and audits. Triage remaining advisories against the deployed execution path. Do not blindly apply `npm audit fix --force`: the scan includes a proposed Zod major-version change. Deployed function dependency versions were not downloaded, so these counts describe the reviewed local lockfiles rather than a separately verified production SBOM.

**Additional findings and hardening**

- **Score structure validation:** the emulator accepted replacing an existing hole with `null`, arbitrary extra hole keys, and a string-valued side-event gross score. The rules protect the top-level `holes` field and preserve its keys, but do not restrict nested shapes/values. Server/client scoring rejects many invalid values, which reduces scoring risk, but does not prevent malformed data storage or all UI/trigger effects. Add bounded hole keys and field/type checks, preserving valid partial scores and explicit null score clearing. This is limited to otherwise authorized writers, plus the public-write exception above.
- **Settlement race:** `functions/src/callables/settlementOps.ts:97` checks the outstanding balance outside a transaction and creates an independent settlement at line 116. Concurrent requests can both reserve the same outstanding amount. This is a code-level concurrency finding, not a production exploit test. Serialize balance reservations with a shared transaction/ledger document and add idempotency. This records debts; it does not itself transfer funds.
- **Push token ownership:** `functions/src/callables/pushOps.ts:64` deletes any supplied token after checking only that the caller is a player. Add a stored-owner check before deletion. Tokens are not publicly readable and are difficult to guess, so abuse requires learning another device's token; no such leak was found.
- **Cost controls:** the limiter in `functions/src/rateLimit.ts` is an in-memory per-instance map, not a global quota. Most callable definitions do not enforce App Check; the paid AI endpoint does. Firestore and Auth App Check were unenforced in the inspected production configuration. Use durable spend/rate controls where needed, appropriate instance caps, and verify budget alerts. Public Firestore data can still be scraped by design. No load testing was performed.
- **Shared-device privacy:** Firestore persists documents in IndexedDB (`rowdy-ui/src/firebase.ts:63`); logout calls `signOut` without clearing that cache. A previously authenticated person's device can retain chat/bet documents after logout. This does not expose those cached documents to a fresh LinkedIn visitor on another device. Consider a shared-device mode or explicit local-data cleanup that respects pending offline scores.
- **Browser hardening:** production serves HSTS, `X-Frame-Options: DENY`, `nosniff`, and a referrer policy. No Content Security Policy was observed. Add a tested CSP, initially in report-only mode if needed; no concrete XSS sink was found in the reviewed text/Markdown rendering. Restrict App Check debug-token injection to development builds; no literal debug token was detected by the production entry-bundle pattern check.
- **Security regression coverage:** no committed Firestore emulator/rules tests or `@firebase/rules-unit-testing` setup were found. The existing test suites do not establish access-control correctness. CI runs builds and unit tests, but lint is non-blocking and there is no dependency-audit job. AGENTS.md also describes the rules endpoint as admin-only, whereas current code intentionally permits linked players. Update these stale documentation claims.

**What the PII protections currently accomplish**

The deployed rules exactly match the reviewed rules. Public player documents currently contain no email/scouting-note fields. Signed-out production requests for a private player profile, bets, settlements, comments, and drafts returned HTTP 403. The emulator also denied private-profile access to an authenticated outsider and rejected client-side admin escalation and forged top-level match results. All inspected callable entry points use a server-side admin/player/captain/planner guard. Player self-link writes are denied.

Names, bundled headshots, handicaps/rosters, golf history, event/course information, and public player IDs/auth UIDs remain accessible as designed. Hidden navigation, `hideDraftPool`, and test flags are not confidentiality controls for public documents. If the intended portfolio experience must conceal identities as well as emails/notes, it needs an anonymized dataset or a separately restricted data model.

**Validation and limits**

- Frontend production build: passed.
- Functions TypeScript build: passed.
- Frontend unit tests: 251 passed.
- Functions test command: 844 passed; this includes 422 source tests plus their compiled `lib` copies, not 844 distinct source tests.
- Local Firestore emulator: 25 assertions reproduced the allow/deny behaviors described above, using synthetic data in `demo-rowdy-security` at loopback port 8097. Vulnerable allow outcomes were deliberately asserted to demonstrate the gaps; this is not a passing security acceptance suite.
- Frontend lint: 43 errors and 63 warnings in the unchanged baseline.
- Tracked-file secret-pattern scan: identified the fixed test password; did not find matching private-key blocks or the sampled provider-secret patterns. This was not a complete Git-history secret audit.
- No production writes, test accounts created, password logins attempted, or deployments performed. Storage deny-all was reviewed locally; deployed Storage rules, complete IAM policy, historical access logs, and billing-alert configuration were not audited. No claim is made that the application has zero vulnerabilities.

Suggested order: close public score editing and self-registration; disable/review test and unapproved accounts; implement membership-based private reads and complete revocation; repair legacy PII writers; update dependencies; add emulator security tests to CI; then re-check production as both a signed-out visitor and an authenticated nonmember before publishing the LinkedIn link.
