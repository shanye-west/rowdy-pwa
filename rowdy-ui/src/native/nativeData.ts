import { createContext, useContext } from "react";
import type { UseTournamentDataResult } from "../hooks/useTournamentData";
export const NativeData = createContext<UseTournamentDataResult | null>(null);
export const useNativeData = () => useContext(NativeData);
