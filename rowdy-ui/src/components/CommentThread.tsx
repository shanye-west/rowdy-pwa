/**
 * Comment thread used on two surfaces: a match's detail page and the sportsbook
 * trash-talk feed. Reading is public; posting/reacting/deleting requires a
 * logged-in player. All write UX is optimistic (see useCommentThread) so the
 * thread feels instant despite writes going through Cloud Function callables.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SmilePlus } from "lucide-react";
import PlayerAvatar from "./PlayerAvatar";
import ConfirmDialog from "./admin/ConfirmDialog";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useCommentThread, REACTION_EMOJI, type DisplayComment } from "../hooks/useComments";
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
  const { comments, loading, canInteract, post, react, remove, canDelete } = useCommentThread({
    tournamentId,
    threadType,
    threadId,
  });

  const [text, setText] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

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
      ) : comments.length === 0 ? (
        <div className="py-3 text-center text-xs text-muted-foreground">No comments yet — be the first.</div>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              meId={player?.id}
              canDelete={!c.pending && canDelete(c)}
              canReact={canInteract && !c.pending}
              pickerOpen={pickerFor === c.id}
              onTogglePicker={() => setPickerFor((cur) => (cur === c.id ? null : c.id))}
              onReact={(emoji) => handleReact(c.id, emoji)}
              onDelete={() => setConfirmDeleteId(c.id)}
            />
          ))}
        </ul>
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
}: {
  text: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
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
          placeholder="Add a comment…"
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
  pickerOpen,
  onTogglePicker,
  onReact,
  onDelete,
}: {
  comment: DisplayComment;
  meId: string | undefined;
  canDelete: boolean;
  canReact: boolean;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  const reactions = comment.reactions ?? {};
  const activeReactions = REACTION_EMOJI.filter((e) => (reactions[e]?.length ?? 0) > 0);

  return (
    <li className={cn("flex gap-2.5 transition-opacity", comment.pending && "opacity-50")}>
      <PlayerAvatar name={comment.authorName} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{comment.authorName}</span>
          <span className="shrink-0 text-[0.7rem] text-muted-foreground">
            {comment.pending ? "Sending…" : timeAgo(comment.createdAt)}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.text}</p>

        {/* Reactions */}
        {(activeReactions.length > 0 || canReact || canDelete) && (
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
    </li>
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
