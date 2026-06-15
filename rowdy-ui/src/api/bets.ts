/**
 * Typed wrappers around the sportsbook (peer-to-peer betting) callables.
 * Mirrors the pattern in api/draft.ts; request/response shapes live in
 * adminContracts.ts (kept in sync with functions/src/callables/contracts.ts).
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type {
  AdminResult,
  BetActionRequest,
  CreateBetOfferRequest,
  CreateBetChallengeRequest,
  CreateBetResult,
  SettleCupFuturesRequest,
  SettleCupFuturesResult,
} from "./adminContracts";

function call<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> =>
    (await httpsCallable<Req, Res>(functions, name)(data)).data;
}

export const betsApi = {
  createBetOffer: call<CreateBetOfferRequest, CreateBetResult>("createBetOffer"),
  createBetChallenge: call<CreateBetChallengeRequest, CreateBetResult>("createBetChallenge"),
  acceptBet: call<BetActionRequest, AdminResult>("acceptBet"),
  confirmBet: call<BetActionRequest, AdminResult>("confirmBet"),
  withdrawAcceptance: call<BetActionRequest, AdminResult>("withdrawAcceptance"),
  cancelBet: call<BetActionRequest, AdminResult>("cancelBet"),
  declineBet: call<BetActionRequest, AdminResult>("declineBet"),
  settleCupFutures: call<SettleCupFuturesRequest, SettleCupFuturesResult>("settleCupFutures"),
};
