/**
 * `askRulesOfficial` — the in-app "Rules Official", an AI that answers in-round
 * rules questions for the 12v12 event from the embedded handbook. Replaces the
 * old menu link out to NotebookLM.
 *
 * Why a callable (not a client-side call to xAI): the xAI key is a real secret.
 * It lives ONLY here as a Functions secret (XAI_API_KEY) and must never reach
 * the browser bundle. The callable is the trust boundary — it requires a
 * logged-in player and rate-limits, then proxies to xAI.
 *
 * Streaming: this is a streaming callable. When the client calls `.stream()`,
 * xAI's SSE deltas are forwarded via `response.sendChunk({ delta })`; the full
 * answer is also returned so non-streaming callers still work.
 *
 * Prompt caching (xAI is automatic — no cache_control breakpoints like
 * Anthropic): the ~15k-token handbook is sent as the FIRST, byte-identical
 * system message on every request, so xAI serves it from cache after the first
 * hit. We also set the `x-grok-conv-id` header (xAI's recommended lever to
 * maximize cache-hit rate) and log `cached_tokens` to confirm it's working.
 * See https://docs.x.ai/developers/advanced-api-usage/prompt-caching
 */

import { onCall, HttpsError, type CallableRequest, type CallableResponse } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { randomUUID } from "node:crypto";
import { requirePlayer } from "../helpers/adminAuth.js";
import { RULES_HANDBOOK } from "./handbook.js";

const XAI_API_KEY = defineSecret("XAI_API_KEY");

const XAI_URL = "https://api.x.ai/v1/chat/completions";
/** Model id — the dot matters: `grok-4-5` returns model-not-found. */
const XAI_MODEL = "grok-4.5";
/** Rules lookup is authoritative retrieval, not hard reasoning — keep it snappy/cheap. */
const REASONING_EFFORT = "low";
/**
 * A CONSTANT cache key (not per-conversation). Every request shares the same
 * ~15k-token handbook prefix, so routing them all under one key keeps that
 * prefix reliably cached across all players — xAI's grok-4.5 docs explicitly
 * recommend setting prompt_cache_key or you may pay full input cost on a
 * cache-cold server. The differing per-user question suffix is tiny by
 * comparison. (Cache correctness is by content hash, so this never needs
 * bumping when the handbook changes — it's only a routing hint.)
 */
const PROMPT_CACHE_KEY = "rules-official";

// Input guards — keep prompts bounded so a bug or abuse can't run up token cost.
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
// Output cap. Rulings are short; this bounds worst-case cost per call regardless
// of how many autoscaled instances the (per-instance) rate limiter spreads over,
// and closes any prompt-injection-for-a-long-completion path.
const MAX_OUTPUT_TOKENS = 1000;

/**
 * The stable system prompt. The handbook is embedded verbatim as the leading
 * block so the whole thing is a byte-identical cache prefix across requests.
 * The role framing below is also constant — do not interpolate anything
 * per-request into this string or you break the cache prefix.
 */
const SYSTEM_PROMPT = `You are the Rules Official for a 12-vs-12, Ryder-Cup-style match-play golf event. Players consult you on their phones mid-round for fast, authoritative in-round rulings.

Answer ONLY from the In-Round Rules Official Guide reproduced below (it incorporates the 2023 Rules of Golf as modified for this event). Do not invent local rules or procedures that aren't in the guide.

How to respond:
- Lead with the ruling in one clear sentence (e.g. the penalty, the correct procedure, or the current match status), then a brief plain-English rationale.
- When the guide has a numbered section that governs, cite it (e.g. "per §7.2").
- Be concise — players are standing over the ball. A few sentences, or a short bullet list, is ideal.
- If a question is about the overall event rather than an in-round decision (total points, standings, pairings, prizes, skins, tournament tie-breaks), do not guess: say it is outside this guide and to ask the Committee.
- If the guide genuinely doesn't cover the situation, say so plainly rather than fabricating an answer.
- Do NOT use markdown tables. Use short paragraphs and simple bullet or numbered lists only.

===== IN-ROUND RULES OFFICIAL GUIDE =====

${RULES_HANDBOOK}`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AskRulesRequest {
  messages?: unknown;
  conversationId?: unknown;
}

interface AskRulesResult {
  text: string;
  cachedTokens: number;
}

/** Validate & sanitize the client-supplied conversation turns. */
function parseMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpsError("invalid-argument", "messages must be a non-empty array");
  }
  // The client resends the whole running conversation each turn. TRIM to the most
  // recent turns rather than rejecting — rejecting would brick a long session
  // (every follow-up 400s) while still leaving cost unbounded. Trimming keeps the
  // session alive AND bounded.
  const recent = raw.slice(-MAX_MESSAGES);
  const messages: ChatMessage[] = recent.map((m) => {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== "user" && role !== "assistant") {
      throw new HttpsError("invalid-argument", "Each message role must be 'user' or 'assistant'");
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new HttpsError("invalid-argument", "Each message needs non-empty string content");
    }
    // Hard-cap only the user's own input. Assistant turns are model-generated
    // (already bounded by MAX_OUTPUT_TOKENS) — clip defensively rather than
    // rejecting client-resent history, which would otherwise dead-end a session
    // after a long prior answer.
    if (role === "user" && content.length > MAX_MESSAGE_CHARS) {
      throw new HttpsError("invalid-argument", `Message too long (max ${MAX_MESSAGE_CHARS} chars)`);
    }
    return { role, content: role === "assistant" ? content.slice(0, MAX_MESSAGE_CHARS) : content };
  });
  if (messages[messages.length - 1].role !== "user") {
    throw new HttpsError("invalid-argument", "The last message must be from the user");
  }
  return messages;
}

/** Keep a client-supplied conversation id to a safe, bounded token. */
function sanitizeConversationId(raw: unknown): string {
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    if (cleaned) return cleaned;
  }
  return randomUUID();
}

/**
 * Stream a chat completion from xAI, forwarding content deltas to the streaming
 * callable response and returning the full text plus cached-token count.
 */
async function streamCompletion(
  apiKey: string,
  conversationId: string,
  messages: ChatMessage[],
  response: CallableResponse<{ delta: string }> | undefined,
  acceptsStreaming: boolean
): Promise<AskRulesResult> {
  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // xAI's recommended lever to maximize prompt-cache hit rate for a
      // conversation. The handbook prefix caches automatically regardless; this
      // helps the growing multi-turn prefix stay warm.
      "x-grok-conv-id": conversationId,
    },
    body: JSON.stringify({
      model: XAI_MODEL,
      reasoning_effort: REASONING_EFFORT,
      stream: true,
      // Bound worst-case output cost (xAI is OpenAI-compatible; max_tokens applies).
      max_tokens: MAX_OUTPUT_TOKENS,
      // Constant key so the shared handbook prefix stays cached across players.
      prompt_cache_key: PROMPT_CACHE_KEY,
      // Ask xAI to emit a final usage chunk so we can log cache effectiveness.
      // (Accepted for OpenAI-compat; if xAI ignores it, cachedTokens stays 0.)
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    logger.error("xAI request failed", { status: res.status, detail: detail.slice(0, 500) });
    // 429 → surface as retryable; everything else as a generic upstream error.
    throw new HttpsError(
      res.status === 429 ? "resource-exhausted" : "unavailable",
      "The Rules Official is unavailable right now. Please try again."
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let cachedTokens = 0;

  // Parse one SSE line; forwards any content delta and captures cached-token count.
  const handleLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return; // skip blanks, `event:`, `:` keep-alives
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return; // ignore malformed partials
    }
    const p = parsed as {
      choices?: { delta?: { content?: string } }[];
      usage?: { prompt_tokens_details?: { cached_tokens?: number } };
    };
    const delta = p.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      // Await sendChunk so chunks are flushed in order and backpressure applies.
      if (acceptsStreaming && response) await response.sendChunk({ delta });
    }
    const cached = p.usage?.prompt_tokens_details?.cached_tokens;
    if (typeof cached === "number") cachedTokens = cached;
  };

  // Read via a reader loop rather than `for await` — WHATWG ReadableStream async
  // iteration is version-dependent, but getReader() is universally supported.
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are newline-delimited; keep the last (possibly partial) line.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) await handleLine(line);
  }
  // Flush any trailing buffered line (stream may end without a final newline).
  if (buffer) await handleLine(buffer);

  return { text: text.trim(), cachedTokens };
}

export const askRulesOfficial = onCall(
  { secrets: [XAI_API_KEY], timeoutSeconds: 120, memory: "256MiB" },
  async (
    request: CallableRequest<AskRulesRequest>,
    response?: CallableResponse<{ delta: string }>
  ): Promise<AskRulesResult> => {
    // Any logged-in player; rate-limited to keep token spend bounded. Note the
    // limiter is an in-memory per-instance Map (see rateLimit.ts) — a soft cap,
    // not a global one; MAX_OUTPUT_TOKENS is what actually bounds per-call cost.
    await requirePlayer(request, "askRulesOfficial", { maxCalls: 30, windowSeconds: 300 });

    const apiKey = XAI_API_KEY.value();
    if (!apiKey) {
      logger.error("askRulesOfficial: XAI_API_KEY secret is not set");
      throw new HttpsError("failed-precondition", "The Rules Official isn't configured yet.");
    }

    const messages = parseMessages(request.data?.messages);
    const conversationId = sanitizeConversationId(request.data?.conversationId);

    const result = await streamCompletion(
      apiKey,
      conversationId,
      messages,
      response,
      request.acceptsStreaming === true
    );

    if (!result.text) {
      throw new HttpsError("unavailable", "The Rules Official didn't return an answer. Please try again.");
    }

    logger.info("askRulesOfficial answered", {
      conversationId,
      turns: messages.length,
      cachedTokens: result.cachedTokens,
      answerChars: result.text.length,
    });
    return result;
  }
);
