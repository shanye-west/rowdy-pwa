/**
 * Comment thread used on two surfaces: a match's detail page and the sportsbook
 * trash-talk feed. Reading is public; posting/reacting/deleting requires a
 * logged-in player. All write UX is optimistic (see useCommentThread) so the
 * thread feels instant despite writes going through Cloud Function callables.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SmilePlus, MessageCircle, ChevronDown, ChevronRight } from "lucide-react";
import PlayerAvatar from "./PlayerAvatar";
import ConfirmDialog from "./admin/ConfirmDialog";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import {
  useCommentThread,
  useReplyThread,
  REACTION_EMOJI,
  type DisplayComment,
} from "../hooks/useComments";
import { cn } from "../lib/utils";
import { toDateOrNull } from "../utils";
import type { CommentThreadType } from "../types";

const MAX_COMMENT_LENGTH = 1000;
/** Show the remaining-characters hint once the composer gets this close to the cap. */
const COUNTER_THRESHOLD = 100;
/** Cap the auto-growing composer so a long draft doesn't take over the screen. */
const COMPOSER_MAX_HEIGHT = 140;

export interface CommentThreadProps {
  threadType: CommentThreadType;
  threadId: string;
  tournamentId: string;
  /** Optional heading shown above the thread. */
  title?: string;
}

export default function CommentThread({ threadType, threadId, tournamentId, title }: CommentThreadProps) {
  const { player } = useAuth();
  const { showToast } = useToast();
  const { comments, loading, error, hasMore, loadingOlder, loadOlder, canInteract, post, react, remove, canDelete } =
    useCommentThread({
      tournamentId,
      threadType,
      threadId,
    });

  const [text, setText] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Which comments have their reply sub-thread open (only these subscribe to replies).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const expandReplies = useCallback((id: string) => setExpanded((s) => (s.has(id) ? s : new Set(s).add(id))), []);
  const toggleReplies = useCallback(
    (id: string) =>
      setExpanded((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Loading older history prepends rows above the viewport, which would shove the
  // user's place down the page. Capture the document height at click time and,
  // once the older rows have rendered, scroll by the growth so their view holds.
  const beforeHeightRef = useRef<number | null>(null);
  const handleLoadOlder = useCallback(() => {
    const el = document.scrollingElement ?? document.documentElement;
    beforeHeightRef.current = el.scrollHeight;
    loadOlder();
  }, [loadOlder]);
  useLayoutEffect(() => {
    if (beforeHeightRef.current === null) return;
    const el = document.scrollingElement ?? document.documentElement;
    el.scrollTop += el.scrollHeight - beforeHeightRef.current;
    beforeHeightRef.current = null;
  }, [comments]);

  const pendingDelete = confirmDeleteId ? comments.find((c) => c.id === confirmDeleteId) : undefined;

  // Re-render on a slow tick so relative timestamps ("5m") stay fresh.
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Dismiss the reaction picker on outside click or Escape.
  useEffect(() => {
    if (!pickerFor) return;
    function onPointerDown(e: MouseEvent) {
      if (!(e.target as Element)?.closest("[data-reaction-picker]")) setPickerFor(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerFor(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerFor]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Comments post through a callable, which (unlike score writes) can't queue
    // offline — say so up front and keep the draft instead of failing obscurely.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showToast({ variant: "error", message: "You're offline — chat needs a connection." });
      return;
    }
    setText("");
    // Optimistic insert is synchronous, so the new row exists by next frame.
    const result = post(trimmed);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    try {
      await result;
    } catch (e) {
      // Restore the draft (unless they've started a new one) so they can resend.
      setText((cur) => cur || trimmed);
      showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't post comment" });
    }
  }, [text, post, showToast]);

  const handleReact = useCallback(
    (commentId: string, emoji: string) => {
      void react(commentId, emoji).catch((e) =>
        showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't react" })
      );
    },
    [react, showToast]
  );

  const handleDelete = useCallback(
    (commentId: string) => {
      void remove(commentId).catch((e) =>
        showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't delete comment" })
      );
    },
    [remove, showToast]
  );

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">{title ?? "Comments"}</h3>
        {comments.length > 0 && <span className="text-xs text-muted-foreground">{comments.length}</span>}
      </div>

      {/* Thread */}
      {loading ? (
        <div className="flex justify-center py-4">
          <div className="spinner-lg" />
        </div>
      ) : error && comments.length === 0 ? (
        // A subscription failure previously rendered as "No comments yet", which
        // invites someone to re-post a message that's actually already there.
        <div className="py-3 text-center text-xs text-muted-foreground">
          Couldn't load comments — check your connection.
        </div>
      ) : comments.length === 0 ? (
        <div className="py-3 text-center text-xs text-muted-foreground">No comments yet — be the first.</div>
      ) : (
        <>
          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleLoadOlder}
                disabled={loadingOlder}
                className="rounded-full px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-muted disabled:text-muted-foreground"
              >
                {loadingOlder ? "Loading…" : "Load earlier comments"}
              </button>
            </div>
          )}
          <ul className="space-y-3">
            {comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                meId={player?.id}
                canDelete={!c.pending && canDelete(c)}
                canReact={canInteract && !c.pending}
                canReply={canInteract && !c.pending}
                replyCount={c.replyCount ?? 0}
                repliesExpanded={expanded.has(c.id)}
                onReply={() => expandReplies(c.id)}
                onToggleReplies={() => toggleReplies(c.id)}
                pickerOpen={pickerFor === c.id}
                onTogglePicker={() => setPickerFor((cur) => (cur === c.id ? null : c.id))}
                onReact={(emoji) => handleReact(c.id, emoji)}
                onDelete={() => setConfirmDeleteId(c.id)}
              >
                {expanded.has(c.id) && (
                  <RepliesSection
                    tournamentId={tournamentId}
                    threadType={threadType}
                    threadId={threadId}
                    parentId={c.id}
                  />
                )}
              </CommentRow>
            ))}
          </ul>
        </>
      )}
      <div ref={bottomRef} />

      {/* Composer */}
      {canInteract ? (
        <Composer text={text} onChange={setText} onSubmit={submit} />
      ) : (
        <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Link to="/login" className="font-semibold text-blue-600 underline">
            Log in
          </Link>{" "}
          to join the conversation.
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        title="Delete comment?"
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (confirmDeleteId) handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      >
        This can't be undone.
        {pendingDelete && (
          <p className="mt-2 line-clamp-3 rounded-lg bg-muted px-3 py-2 text-muted-foreground italic">
            "{pendingDelete.text}"
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

// ============================================================================
// COMPOSER
// ============================================================================

function Composer({
  text,
  onChange,
  onSubmit,
  placeholder = "Add a comment…",
}: {
  text: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const remaining = MAX_COMMENT_LENGTH - text.length;

  // Grow with content up to a cap, then scroll internally.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [text]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline. Ignore IME composition.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_COMMENT_LENGTH}
          rows={1}
          placeholder={placeholder}
          className="max-h-[140px] min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!text.trim()}
          className="h-9 shrink-0 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white transition-transform active:scale-95 disabled:bg-muted disabled:text-muted-foreground"
        >
          Post
        </button>
      </div>
      {remaining <= COUNTER_THRESHOLD && (
        <div className={cn("text-right text-[0.7rem]", remaining <= 0 ? "text-red-500" : "text-muted-foreground")}>
          {remaining} left
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ROW
// ============================================================================

function CommentRow({
  comment,
  meId,
  canDelete,
  canReact,
  canReply,
  replyCount,
  repliesExpanded,
  onReply,
  onToggleReplies,
  pickerOpen,
  onTogglePicker,
  onReact,
  onDelete,
  children,
}: {
  comment: DisplayComment;
  meId: string | undefined;
  canDelete: boolean;
  canReact: boolean;
  canReply: boolean;
  replyCount: number;
  repliesExpanded: boolean;
  onReply: () => void;
  onToggleReplies: () => void;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  children?: ReactNode;
}) {
  const reactions = comment.reactions ?? {};
  const activeReactions = REACTION_EMOJI.filter((e) => (reactions[e]?.length ?? 0) > 0);

  return (
    <li>
      <div className={cn("flex gap-2.5 transition-opacity", comment.pending && "opacity-50")}>
        <PlayerAvatar name={comment.authorName} playerId={comment.authorId} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{comment.authorName}</span>
            <span className="shrink-0 text-[0.7rem] text-muted-foreground">
              {comment.pending ? "Sending…" : timeAgo(comment.createdAt)}
            </span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.text}</p>

          {/* Reactions + reply actions */}
          {(activeReactions.length > 0 || canReact || canDelete || canReply || replyCount > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {activeReactions.map((emoji) => {
              const ids = reactions[emoji] ?? [];
              const mine = !!meId && ids.includes(meId);
              return (
                <button
                  key={emoji}
                  type="button"
                  disabled={!canReact}
                  onClick={() => onReact(emoji)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors disabled:opacity-100",
                    mine ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground hover:bg-muted"
                  )}
                >
                  <span>{emoji}</span>
                  <span className="font-semibold">{ids.length}</span>
                </button>
              );
            })}

            {canReact && (
              <div className="relative" data-reaction-picker>
                <button
                  type="button"
                  onClick={onTogglePicker}
                  aria-label="Add reaction"
                  aria-expanded={pickerOpen}
                  className={cn(
                    "flex items-center rounded-full px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground",
                    pickerOpen && "bg-muted text-muted-foreground"
                  )}
                >
                  <SmilePlus size={16} />
                </button>
                {pickerOpen && (
                  <div className="absolute left-0 top-7 z-10 flex gap-1 rounded-full border border-border bg-card px-2 py-1 shadow-md">
                    {REACTION_EMOJI.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          onReact(emoji);
                          onTogglePicker();
                        }}
                        className="rounded-full px-1 text-base transition-transform hover:scale-110 active:scale-90"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canReply && (
              <button
                type="button"
                onClick={onReply}
                className="flex items-center gap-1 text-[0.7rem] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <MessageCircle size={13} />
                Reply
              </button>
            )}

            {replyCount > 0 && (
              <button
                type="button"
                onClick={onToggleReplies}
                aria-expanded={repliesExpanded}
                className="flex items-center gap-0.5 text-[0.7rem] font-semibold text-blue-600 hover:underline"
              >
                {repliesExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {replyCount} {replyCount === 1 ? "reply" : "replies"}
              </button>
            )}

            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="ml-auto text-[0.7rem] font-semibold text-muted-foreground hover:text-red-600"
              >
                Delete
              </button>
            )}
            </div>
          )}
        </div>
      </div>
      {children && <div className="ml-[42px] mt-2">{children}</div>}
    </li>
  );
}

// ============================================================================
// REPLIES (one-level sub-thread shown under an expanded comment)
// ============================================================================

function RepliesSection({
  tournamentId,
  threadType,
  threadId,
  parentId,
}: {
  tournamentId: string;
  threadType: CommentThreadType;
  threadId: string;
  parentId: string;
}) {
  const { showToast } = useToast();
  const { replies, loading, canInteract, post, remove, canDelete } = useReplyThread({
    tournamentId,
    threadType,
    threadId,
    parentId,
  });

  const [text, setText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const pendingDelete = confirmDeleteId ? replies.find((r) => r.id === confirmDeleteId) : undefined;

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showToast({ variant: "error", message: "You're offline — chat needs a connection." });
      return;
    }
    setText("");
    try {
      await post(trimmed);
    } catch (e) {
      setText((cur) => cur || trimmed);
      showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't post reply" });
    }
  }, [text, post, showToast]);

  const handleDelete = useCallback(
    (replyId: string) => {
      void remove(replyId).catch((e) =>
        showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't delete reply" })
      );
    },
    [remove, showToast]
  );

  return (
    <div className="space-y-2 border-l-2 border-border pl-3">
      {loading && replies.length === 0 ? (
        <div className="flex justify-center py-2">
          <div className="spinner" />
        </div>
      ) : (
        replies.map((r) => (
          <ReplyRow
            key={r.id}
            reply={r}
            canDelete={!r.pending && canDelete(r)}
            onDelete={() => setConfirmDeleteId(r.id)}
          />
        ))
      )}

      {canInteract ? (
        <Composer text={text} onChange={setText} onSubmit={submit} placeholder="Reply…" />
      ) : (
        <div className="rounded-lg bg-muted px-3 py-1.5 text-[0.7rem] text-muted-foreground">
          <Link to="/login" className="font-semibold text-blue-600 underline">
            Log in
          </Link>{" "}
          to reply.
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        title="Delete reply?"
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (confirmDeleteId) handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      >
        This can't be undone.
        {pendingDelete && (
          <p className="mt-2 line-clamp-3 rounded-lg bg-muted px-3 py-2 text-muted-foreground italic">
            "{pendingDelete.text}"
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function ReplyRow({
  reply,
  canDelete,
  onDelete,
}: {
  reply: DisplayComment;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className={cn("flex gap-2 transition-opacity", reply.pending && "opacity-50")}>
      <PlayerAvatar name={reply.authorName} playerId={reply.authorId} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-semibold text-foreground">{reply.authorName}</span>
          <span className="shrink-0 text-[0.65rem] text-muted-foreground">
            {reply.pending ? "Sending…" : timeAgo(reply.createdAt)}
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto text-[0.65rem] font-semibold text-muted-foreground hover:text-red-600"
            >
              Delete
            </button>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{reply.text}</p>
      </div>
    </div>
  );
}

/** Compact relative time ("just now", "5m", "3h", "2d", else a date). */
function timeAgo(value: DisplayComment["createdAt"]): string {
  const date = toDateOrNull(value);
  if (!date) return "";
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
