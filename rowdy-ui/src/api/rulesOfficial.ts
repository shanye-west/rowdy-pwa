/**
 * Client wrapper for the streaming `askRulesOfficial` callable (the in-app AI
 * Rules Official). Uses the callable `.stream()` API so answers render token by
 * token. The xAI key never touches the browser — the callable proxies to xAI.
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export interface RulesChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AskRulesRequest {
  messages: RulesChatMessage[];
  conversationId: string;
}

interface AskRulesResult {
  text: string;
  cachedTokens: number;
}

interface RulesStreamChunk {
  delta: string;
}

/**
 * Ask the Rules Official, streaming the answer. `onDelta` fires for each text
 * chunk as it arrives; the promise resolves with the complete answer.
 *
 * Pass the full running conversation in `messages` (last entry must be the new
 * user question) and a stable `conversationId` for the session so the growing
 * prompt prefix stays cache-warm on xAI.
 */
export async function streamRulesAnswer(
  messages: RulesChatMessage[],
  conversationId: string,
  onDelta: (delta: string) => void
): Promise<string> {
  const callable = httpsCallable<AskRulesRequest, AskRulesResult, RulesStreamChunk>(
    functions,
    "askRulesOfficial"
  );

  const { stream, data } = await callable.stream({ messages, conversationId });

  let streamed = "";
  for await (const chunk of stream) {
    if (chunk?.delta) {
      streamed += chunk.delta;
      onDelta(chunk.delta);
    }
  }

  // Prefer the authoritative final payload; fall back to the streamed text if a
  // client SDK returns an empty final (e.g. streaming disabled by a proxy).
  const final = await data;
  return final?.text || streamed;
}
