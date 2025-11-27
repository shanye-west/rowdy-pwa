import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { 
  auth, 
  db,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User
} from "../firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import type { PlayerDoc } from "../types";

type AuthContextType = {
  // Current Firebase Auth user
  user: User | null;
  // Current player doc (linked via authUid)
  player: PlayerDoc | null;
  // True while checking auth state
  loading: boolean;
  // Login with email + password
  login: (email: string, password: string, rememberMe: boolean) => Promise<{ success: boolean; error?: string }>;
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
        // User is logged in - find their player doc by authUid
        try {
          const playersRef = collection(db, "players");
          const q = query(playersRef, where("authUid", "==", firebaseUser.uid));
          const snap = await getDocs(q);
          
          if (!snap.empty) {
            const playerDoc = snap.docs[0];
            setPlayer({ id: playerDoc.id, ...playerDoc.data() } as PlayerDoc);
          } else {
            // Auth user exists but no linked player doc
            console.warn("No player doc found for auth user:", firebaseUser.uid);
            setPlayer(null);
          }
        } catch (e) {
          console.error("Error fetching player doc:", e);
          setPlayer(null);
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
    password: string, 
    rememberMe: boolean
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Set persistence based on remember me
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      
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

  const value: AuthContextType = {
    user,
    player,
    loading,
    login,
    resetPassword,
    logout,
    canEditMatch
  };

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
