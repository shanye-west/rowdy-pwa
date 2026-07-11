# Rowdy Cup PWA — Copilot Instructions

**This project's AI guidance lives in [`AGENTS.md`](../AGENTS.md) at the repo root.** It is the single, tool-agnostic source of truth for architecture, the Firestore data model, scoring & stats contracts, the Cloud Functions map, security rules, and coding conventions. Read it before making changes.

Two things to internalize immediately:

1. **Production is the only environment.** There is no staging — every deploy and every non-emulator run touches live tournament data (Firebase project `rowdy-pwa`). Confirm before writing to Firestore or deploying.
2. **`tsc` is the feedback loop.** `cd rowdy-ui && npm run build` runs `tsc -b` first; keep it clean. For backend/scoring work also keep `cd functions && npm run test:run` green.

Everything else — collections, formats, functions, conventions — is in [`AGENTS.md`](../AGENTS.md).
