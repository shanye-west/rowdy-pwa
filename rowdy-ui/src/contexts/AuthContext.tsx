import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { 
  auth,
  db,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User
} from "../firebase";
import { collection, doc, query, where } from "firebase/firestore";
import { getDocCacheFirst, getDocsCacheFirst } from "../utils/firestoreReads";
import type { PlayerDoc } from "../types";

// Last successfully-resolved "authUid:playerId" pair. The player doc is found
// via a *query* (authUid == uid), which needs either the network or that exact
// query in the local cache — on a cold-cache offline launch it fails and would
// silently disable scoring. This hint lets us fall back to a direct doc lookup
// (which the persistent cache can answer) so a returning player can still score.
const LAST_PLAYER_KEY = "rowdycup:lastPlayer";

function savePlayerHint(uid: string, playerId: string) {
  try {
    localStorage.setItem(LAST_PLAYER_KEY, `${uid}:${playerId}`);
  } catch {
    /* storage unavailable (private mode) — hint is best-effort */
  }
}

/** Resolve the player from the stored hint; verifies the doc still maps to `uid`. */
async function resolvePlayerFromHint(uid: string): Promise<PlayerDoc | null> {
  try {
    const raw = localStorage.getItem(LAST_PLAYER_KEY);
    if (!raw) return null;
    const sep = raw.indexOf(":");
    const hintUid = raw.slice(0, sep);
    const playerId = raw.slice(sep + 1);
    if (hintUid !== uid || !playerId) return null;
    const snap = await getDocCacheFirst(doc(db, "players", playerId));
    if (!snap.exists()) return null;
    const p = { id: snap.id, ...snap.data() } as PlayerDoc;
    return p.authUid === uid ? p : null;
  } catch {
    return null;
  }
}

type AuthContextType = {
  // Current Firebase Auth user
  user: User | null;
  // Current player doc (linked via authUid)
  player: PlayerDoc | null;
  // True while checking auth state
  loading: boolean;
  // Login with email + password
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  // Send password reset email
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  // Log out
  logout: () => Promise<void>;
  // Check if player can edit a match (is rostered in this match)
  canEditMatch: (teamAPlayerIds: string[], teamBPlayerIds: string[]) => boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [player, setPlayer] = useState<PlayerDoc | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen for Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (firebaseUser) {
        const uid = firebaseUser.uid;
        const applyPlayer = (p: PlayerDoc) => {
          setPlayer(p);
          savePlayerHint(uid, p.id);
        };

        // Find the player doc by authUid — cache-first so a returning user
        // resolves instantly (and offline) from IndexedDB. The mapping can
        // change (admin relinks), so a cache hit still revalidates quietly.
        try {
          const q = query(collection(db, "players"), where("authUid", "==", uid));
          const snap = await getDocsCacheFirst(q, (fresh) => {
            if (!fresh.empty) {
              const d = fresh.docs[0];
              applyPlayer({ id: d.id, ...d.data() } as PlayerDoc);
            }
          });

          if (!snap.empty) {
            const playerDoc = snap.docs[0];
            applyPlayer({ id: playerDoc.id, ...playerDoc.data() } as PlayerDoc);
          } else {
            // Empty can also mean "offline with a cold query cache" — try the
            // last-known player id before concluding there's no linked doc.
            const hinted = await resolvePlayerFromHint(uid);
            if (hinted) {
              setPlayer(hinted);
            } else {
              // Auth user exists but no linked player doc
              console.warn("No player doc found for auth user:", uid);
              setPlayer(null);
            }
          }
        } catch (e) {
          // Query failed outright (typically offline). Fall back to the hint so
          // scoring stays enabled for a returning player with a warmed cache.
          const hinted = await resolvePlayerFromHint(uid);
          if (hinted) {
            setPlayer(hinted);
          } else {
            console.error("Error fetching player doc:", e);
            setPlayer(null);
          }
        }
      } else {
        setPlayer(null);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Login with email + password
  const login = useCallback(async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Always local persistence: session persistence doesn't survive an app
      // kill, so a scorer who cold-starts offline mid-round would lose auth
      // and be unable to score until back online.
      await setPersistence(auth, browserLocalPersistence);
      
      // Sign in with Firebase Auth
      await signInWithEmailAndPassword(auth, email, password);
      
      // onAuthStateChanged will handle setting user and player
      return { success: true };
    } catch (e: any) {
      console.error("Login error:", e);
      
      // Friendly error messages
      if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
        return { success: false, error: "Invalid email or password" };
      }
      if (e.code === "auth/invalid-email") {
        return { success: false, error: "Invalid email address" };
      }
      
      return { success: false, error: e.message || "Login failed" };
    }
  }, []);

  // Send password reset email
  const resetPassword = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await sendPasswordResetEmail(auth, email);
      return { success: true };
    } catch (e: any) {
      console.error("Password reset error:", e);
      
      if (e.code === "auth/user-not-found") {
        return { success: false, error: "No account found with this email" };
      }
      if (e.code === "auth/invalid-email") {
        return { success: false, error: "Invalid email address" };
      }
      
      return { success: false, error: e.message || "Failed to send reset email" };
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      setUser(null);
      setPlayer(null);
    } catch (e) {
      console.error("Logout error:", e);
    }
  }, []);

  // Check if current player can edit a match
  const canEditMatch = useCallback((teamAPlayerIds: string[], teamBPlayerIds: string[]): boolean => {
    if (!player) return false;
    const allPlayerIds = [...teamAPlayerIds, ...teamBPlayerIds];
    return allPlayerIds.includes(player.id);
  }, [player]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      player,
      loading,
      login,
      resetPassword,
      logout,
      canEditMatch,
    }),
    [user, player, loading, login, resetPassword, logout, canEditMatch]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
