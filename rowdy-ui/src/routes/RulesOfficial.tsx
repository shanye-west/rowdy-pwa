import { useEffect, useRef, useState } from "react";
import { BookOpen, Send, Loader2, Gavel } from "lucide-react";
import Layout from "../components/Layout";
import MarkdownLite from "../components/MarkdownLite";
import { Button } from "../components/ui/button";
import { ViewTransitionLink } from "../components/ViewTransitionLink";
import { useAuth } from "../contexts/AuthContext";
import { useTournamentContext } from "../contexts/TournamentContext";
import { streamRulesAnswer, type RulesChatMessage } from "../api/rulesOfficial";

/** Starter questions shown on the empty state. */
const SUGGESTIONS = [
  "My ball is in a divot in the fairway — free relief?",
  "In a shamble, can we both play my partner's drive?",
  "Opponent conceded my next putt — can I still hole out?",
  "Ball probably out of bounds — should I play a provisional?",
];

/** Max prior turns sent upstream — stays under the callable's MAX_MESSAGES (20). */
const MAX_HISTORY = 18;

/** A displayed turn. `error` marks a UI-only failure bubble we never send back. */
type ChatMsg = RulesChatMessage & { error?: boolean };

export default function RulesOfficial() {
  const { user, loading } = useAuth();
  const { tournament } = useTournamentContext();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // Stable per-session id so the growing prompt prefix stays cache-warm on xAI.
  const [conversationId] = useState(() => crypto.randomUUID());

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || streaming) return;

    const userMsg: ChatMsg = { role: "user", content: q };
    // What we send upstream: only clean, successful turns (drop error/empty
    // bubbles so failed exchanges never re-enter the model's history), capped to
    // the newest MAX_HISTORY so a long session never trips the server's limit.
    const history: RulesChatMessage[] = [...messages, userMsg]
      .filter((m) => !m.error && m.content.trim() !== "")
      .map(({ role, content }) => ({ role, content }))
      .slice(-MAX_HISTORY);

    // Display: the full thread plus an empty assistant bubble we fill as tokens arrive.
    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const appendDelta = (delta: string) => {
      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: last.content + delta };
        }
        return copy;
      });
    };

    try {
      const text = await streamRulesAnswer(history, conversationId, appendDelta);
      // Ensure the final bubble holds the authoritative full answer.
      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: text };
        return copy;
      });
    } catch (err) {
      console.error("Rules Official request failed", err);
      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          // error: true keeps this a UI-only bubble — it's excluded from the
          // history we send upstream on the next question.
          copy[copy.length - 1] = {
            ...last,
            error: true,
            content:
              "Sorry — I couldn't reach the Rules Official just now. Check your connection and try again.",
          };
        }
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const series = tournament?.series;
  const logo = tournament?.tournamentLogo;

  // Auth gate — the callable requires a logged-in, linked player.
  if (!loading && !user) {
    return (
      <Layout title="Rules Official" series={series} showBack tournamentLogo={logo}>
        <div className="empty-state">
          <div className="empty-state-icon">📖</div>
          <div className="empty-state-text">Log in to ask the Rules Official.</div>
          <Button asChild className="mt-4">
            <ViewTransitionLink to="/login">Log in</ViewTransitionLink>
          </Button>
        </div>
      </Layout>
    );
  }

  const empty = messages.length === 0;

  return (
    <Layout title="Rules Official" series={series} showBack tournamentLogo={logo}>
      {/* Body scrolls (matching the app shell); the composer is fixed above the
          bottom nav like the toast/FAB pattern. pb clears the fixed composer. */}
      <div className="px-4 pt-4 pb-32">
        {empty ? (
          <div className="mx-auto max-w-md pt-2 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Gavel className="h-7 w-7 text-brand-primary" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Ask the Rules Official</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              In-round rulings for our formats — scramble, shamble, best ball, and singles.
              Answers come from the event rules guide.
            </p>
            <div className="mt-5 grid gap-2 text-left">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-card-foreground transition-colors hover:bg-muted active:scale-[0.99]"
                >
                  <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{s}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-3">
            {messages.map((m, i) => {
              const isUser = m.role === "user";
              const isLast = i === messages.length - 1;
              const pending = !isUser && isLast && streaming && m.content === "";
              return (
                <div key={i} className={isUser ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      isUser
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-primary-2))] px-3.5 py-2 text-sm text-white"
                        : "max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2 text-sm text-card-foreground"
                    }
                  >
                    {isUser ? (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    ) : pending ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Consulting the rules…
                      </span>
                    ) : (
                      <MarkdownLite text={m.content} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* scroll-margin clears the fixed composer (~96px) + bottom nav so the
            newest reply lands above them, not hidden underneath. */}
        <div
          ref={bottomRef}
          style={{ scrollMarginBottom: "calc(var(--bottom-nav-height) + 112px + env(safe-area-inset-bottom, 0px))" }}
        />
      </div>

      {/* Fixed composer, anchored just above the bottom nav (see .toast-viewport). */}
      <div
        className="fixed left-1/2 z-30 w-full -translate-x-1/2 border-t border-border bg-background/95 px-3 pt-2.5 backdrop-blur"
        style={{
          maxWidth: "var(--max-width)",
          bottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px))",
          paddingBottom: "0.5rem",
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask a rules question…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            size="icon"
            onClick={() => void send(input)}
            disabled={streaming || input.trim() === ""}
            aria-label="Send"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          AI guidance from the event rules guide. The Committee's ruling is final.
        </p>
      </div>
    </Layout>
  );
}
