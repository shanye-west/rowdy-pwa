/**
 * Regenerates functions/src/rulesOfficial/handbook.ts from the human-editable
 * source guide at the repo root.
 *
 * WHY a generated .ts constant (not fs.readFileSync at runtime):
 *   - The handbook must reach the deployed function as a byte-for-byte stable
 *     string so xAI prompt caching hits on the identical leading system
 *     message. Embedding it in the bundle guarantees that; runtime file IO in a
 *     Cloud Function is fragile (tsc doesn't copy .md into lib/).
 *   - JSON.stringify escapes backticks / ${ / newlines safely — no template
 *     literal escaping foot-guns.
 *
 * Run after editing the source guide:  npm run gen:handbook   (in functions/)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, "..", "..", "12v12_ryder_cup_in_round_rules_official_guide.md");
const OUT = join(here, "..", "src", "rulesOfficial", "handbook.ts");

const md = readFileSync(SOURCE, "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n";

const banner = `/**
 * The 12v12 in-round Rules Official guide, embedded as a byte-stable constant.
 *
 * DO NOT EDIT BY HAND. Generated from the repo-root source guide by
 * functions/scripts/gen-rules-handbook.mjs (npm run gen:handbook). Editing the
 * source .md and regenerating keeps this identical across every request, which
 * is what lets xAI cache the ~15k-token handbook prefix (see askRulesOfficial).
 */
`;

writeFileSync(OUT, `${banner}export const RULES_HANDBOOK = ${JSON.stringify(md)};\n`);

const tokens = Math.round(md.length / 4);
console.log(`Wrote ${OUT}`);
console.log(`  ${md.length} chars (~${tokens} tokens)`);
