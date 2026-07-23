/**
 * Typed wrappers around every admin callable. Use these instead of calling
 * httpsCallable() inline so request/response shapes are checked against
 * adminContracts.ts (mirrored in functions/src/callables/contracts.ts).
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import type {
  AdminResult,
  AdminOverrideHoleScoreRequest,
  ComputeRoundRecapRequest,
  ComputeRoundRecapResult,
  CreatePlayerRequest,
  CreateRoundRequest,
  CreateRoundResult,
  CreateTournamentRequest,
  CreateTournamentResult,
  DeleteCourseRequest,
  DeleteMatchRequest,
  DeletePlayerRequest,
  DeleteRoundRequest,
  DeleteRoundResult,
  EditMatchRequest,
  GetPlayerPrivateRequest,
  GetPlayerPrivateResult,
  LinkAuthToPlayerRequest,
  LinkAuthToPlayerResult,
  RecalculateAllStatsRequest,
  RecalculateAllStatsResult,
  RecalculateMatchStrokesRequest,
  RecalculateMatchStrokesResult,
  SeedMatchRequest,
  SeedMatchResult,
  SetMatchLockRequest,
  SetMatchLockResult,
  SetPlayerAdminRequest,
  UpdatePlayerInfoRequest,
  UpdateRoundRequest,
  UpdateRoundResult,
  UpdateTournamentRequest,
  UpdateTournamentResult,
  UpsertCourseRequest,
  UpsertCourseResult,
} from "./adminContracts";

function call<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> =>
    (await httpsCallable<Req, Res>(functions, name)(data)).data;
}

export const adminApi = {
  // Tournament
  createTournament: call<CreateTournamentRequest, CreateTournamentResult>("createTournament"),
  updateTournament: call<UpdateTournamentRequest, UpdateTournamentResult>("updateTournament"),

  // Round
  createRound: call<CreateRoundRequest, CreateRoundResult>("createRound"),
  updateRound: call<UpdateRoundRequest, UpdateRoundResult>("updateRound"),
  deleteRound: call<DeleteRoundRequest, DeleteRoundResult>("deleteRound"),

  // Match
  seedMatch: call<SeedMatchRequest, SeedMatchResult>("seedMatch"),
  editMatch: call<EditMatchRequest, AdminResult>("editMatch"),
  setMatchLock: call<SetMatchLockRequest, SetMatchLockResult>("setMatchLock"),
  adminOverrideHoleScore: call<AdminOverrideHoleScoreRequest, AdminResult>("adminOverrideHoleScore"),
  deleteMatch: call<DeleteMatchRequest, AdminResult>("deleteMatch"),
  recalculateMatchStrokes: call<RecalculateMatchStrokesRequest, RecalculateMatchStrokesResult>("recalculateMatchStrokes"),

  // Player
  createPlayer: call<CreatePlayerRequest, AdminResult>("createPlayer"),
  updatePlayerInfo: call<UpdatePlayerInfoRequest, AdminResult>("updatePlayerInfo"),
  linkAuthToPlayer: call<LinkAuthToPlayerRequest, LinkAuthToPlayerResult>("linkAuthToPlayer"),
  getPlayerPrivate: call<GetPlayerPrivateRequest, GetPlayerPrivateResult>("getPlayerPrivate"),
  deletePlayer: call<DeletePlayerRequest, AdminResult>("deletePlayer"),
  setPlayerAdmin: call<SetPlayerAdminRequest, AdminResult>("setPlayerAdmin"),

  // Course
  upsertCourse: call<UpsertCourseRequest, UpsertCourseResult>("upsertCourse"),
  deleteCourse: call<DeleteCourseRequest, AdminResult>("deleteCourse"),

  // Stats
  recalculateAllStats: call<RecalculateAllStatsRequest, RecalculateAllStatsResult>("recalculateAllStats"),
  computeRoundRecap: call<ComputeRoundRecapRequest, ComputeRoundRecapResult>("computeRoundRecap"),
};
