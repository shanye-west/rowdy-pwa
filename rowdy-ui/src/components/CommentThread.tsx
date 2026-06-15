/**
 * Comment thread used on two surfaces: a match's detail page and the sportsbook
 * trash-talk feed. Reading is public; posting/reacting/deleting requires a
 * logged-in player and goes through the commentOps callables.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import PlayerAvatar from "./PlayerAvatar";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useComments } from "../hooks/useComments";
import { commentsApi } from "../api/comments";
import { toDateOrNull } from "../utils";
import type { CommentDoc, CommentThreadType } from "../types";

/** Emoji reactions a comment may carry. Keep in sync with commentOps.ts. */
const REACTION_EMOJI = ["👍", "🔥", "😂", "⛳", "💀"] as const;

const MAX_COMMENT_LENGTH = 1000;

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
  const { comments, loading } = useComments(threadId);

  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  async function runAction(fn: () => Promise<unknown>, errorFallback = "Something went wrong") {
    try {
      await fn();
    } catch (e) {
      showToast({ variant: "error", message: e instanceof Error ? e.message : errorFallback });
    }
  }

  async function handlePost() {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      await commentsApi.postComment({ tournamentId, threadType, threadId, text: trimmed });
      setText("");
    } catch (e) {
      showToast({ variant: "error", message: e instanceof Error ? e.message : "Couldn't post comment" });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">{title ?? "Comments"}</h3>
        {comments.length > 0 && <span className="text-xs text-slate-400">{comments.length}</span>}
      </div>

      {/* Composer */}
      {player ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_COMMENT_LENGTH}
            rows={2}
            placeholder="Add a comment…"
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handlePost}
              disabled={posting || !text.trim()}
              className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition-transform active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <Link to="/login" className="font-semibold text-blue-600 underline">
            Log in
          </Link>{" "}
          to join the conversation.
        </div>
      )}

      {/* Thread */}
      {loading ? (
        <div className="flex justify-center py-4">
          <div className="spinner-lg" />
        </div>
      ) : comments.length === 0 ? (
        <div className="py-3 text-center text-xs text-slate-400">No comments yet — be the first.</div>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              meId={player?.id}
              canDelete={!!player && (player.id === c.authorId || !!player.isAdmin)}
              canReact={!!player}
              pickerOpen={pickerFor === c.id}
              onTogglePicker={() => setPickerFor((cur) => (cur === c.id ? null : c.id))}
              onReact={(emoji) => runAction(() => commentsApi.toggleReaction({ commentId: c.id, emoji }))}
              onDelete={() => runAction(() => commentsApi.deleteComment({ commentId: c.id }), "Couldn't delete comment")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

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
  comment: CommentDoc;
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
    <li className="flex gap-2.5">
      <PlayerAvatar name={comment.authorName} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-slate-900">{comment.authorName}</span>
          <span className="shrink-0 text-[0.7rem] text-slate-400">{timeAgo(comment.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{comment.text}</p>

        {/* Reactions */}
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
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors disabled:opacity-100 ${
                  mine ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <span>{emoji}</span>
                <span className="font-semibold">{ids.length}</span>
              </button>
            );
          })}

          {canReact && (
            <div className="relative">
              <button
                type="button"
                onClick={onTogglePicker}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-200"
                aria-label="Add reaction"
              >
                😀﹢
              </button>
              {pickerOpen && (
                <div className="absolute left-0 top-7 z-10 flex gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-md">
                  {REACTION_EMOJI.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onReact(emoji);
                        onTogglePicker();
                      }}
                      className="rounded-full px-1 text-base transition-transform active:scale-90"
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
              className="ml-auto text-[0.7rem] font-semibold text-slate-400 hover:text-red-600"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Compact relative time ("just now", "5m", "3h", "2d", else a date). */
function timeAgo(value: CommentDoc["createdAt"]): string {
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
