/**
 * Typed wrappers around the pairings-draft callables. Mirrors the pattern in
 * api/admin.ts; request/response shapes live in adminContracts.ts (kept in sync
 * with functions/src/callables/contracts.ts).
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type {
  AdminResult,
  CreatePairingDraftRequest,
  CreatePairingDraftResult,
  FinalizePairingDraftRequest,
  FinalizePairingDraftResult,
  ResetPairingDraftRequest,
  SavePairingPlanRequest,
  SetPairingDraftVisibilityRequest,
  StartPairingDraftRequest,
  SubmitDraftPickRequest,
  UndoDraftPickRequest,
} from "./adminContracts";

function call<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> =>
    (await httpsCallable<Req, Res>(functions, name)(data)).data;
}

export const draftApi = {
  createPairingDraft: call<CreatePairingDraftRequest, CreatePairingDraftResult>("createPairingDraft"),
  startPairingDraft: call<StartPairingDraftRequest, AdminResult>("startPairingDraft"),
  submitDraftPick: call<SubmitDraftPickRequest, AdminResult>("submitDraftPick"),
  undoDraftPick: call<UndoDraftPickRequest, AdminResult>("undoDraftPick"),
  resetPairingDraft: call<ResetPairingDraftRequest, AdminResult>("resetPairingDraft"),
  /** Publish the board to the whole field, or hide it again (admin only). */
  setPairingDraftVisibility: call<SetPairingDraftVisibilityRequest, AdminResult>("setPairingDraftVisibility"),
  finalizePairingDraft: call<FinalizePairingDraftRequest, FinalizePairingDraftResult>("finalizePairingDraft"),
  /** Captains only (no admin bypass) — saves that team's private pairing plan. */
  savePairingPlan: call<SavePairingPlanRequest, AdminResult>("savePairingPlan"),
};
