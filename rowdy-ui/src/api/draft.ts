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
  SubmitDraftPickRequest,
  UndoDraftPickRequest,
} from "./adminContracts";

function call<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> =>
    (await httpsCallable<Req, Res>(functions, name)(data)).data;
}

export const draftApi = {
  createPairingDraft: call<CreatePairingDraftRequest, CreatePairingDraftResult>("createPairingDraft"),
  submitDraftPick: call<SubmitDraftPickRequest, AdminResult>("submitDraftPick"),
  undoDraftPick: call<UndoDraftPickRequest, AdminResult>("undoDraftPick"),
  resetPairingDraft: call<ResetPairingDraftRequest, AdminResult>("resetPairingDraft"),
  finalizePairingDraft: call<FinalizePairingDraftRequest, FinalizePairingDraftResult>("finalizePairingDraft"),
};
