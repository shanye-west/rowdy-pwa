/**
 * Typed wrappers around the comments callables (match threads + the sportsbook
 * trash-talk feed). Mirrors the pattern in api/bets.ts; request/response shapes
 * live in adminContracts.ts (kept in sync with functions/src/callables/contracts.ts).
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type {
  AdminResult,
  PostCommentRequest,
  PostCommentResult,
  DeleteCommentRequest,
  ToggleReactionRequest,
} from "./adminContracts";

function call<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> =>
    (await httpsCallable<Req, Res>(functions, name)(data)).data;
}

export const commentsApi = {
  postComment: call<PostCommentRequest, PostCommentResult>("postComment"),
  deleteComment: call<DeleteCommentRequest, AdminResult>("deleteComment"),
  toggleReaction: call<ToggleReactionRequest, AdminResult>("toggleReaction"),
};
