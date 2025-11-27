import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { 
  auth, 
  db,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User
} from "../firebase";
import { collection, query, where, getDocs, doc, updateDoc, getDoc } from "firebase/firestore";
import type { PlayerDoc } from "../types";

type AuthContextType = {
  // Current Firebase Auth user (null if not logged in with email/password)
  user: User | null;
  // Current player doc (set for both temp login and full login)
  player: PlayerDoc | null;
  // True while checking auth state
  loading: boolean;
  // True if player logged in with temp password but hasn't set up email/password yet
  needsSetup: boolean;
  // Login with username + temp password (first-time login)
  loginWithUsername: (username: string, password: string, rememberMe: boolean) => Promise<{ success: boolean; error?: string }>;
  // Login with email + password (returning user)
  loginWithEmail: (email: string, password: string, rememberMe: boolean) => Promise<{ success: boolean; error?: string }>;
  // Set up permanent account (email + password) after temp login
  setupAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  // Log out
  logout: () => Promise<void>;
  // Check if player can edit a match (is rostered and has completed setup)
  canEditMatch: (teamAPlayerIds: string[], teamBPlayerIds: string[]) => boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [player, setPlayer] = useState<PlayerDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Listen for Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (firebaseUser) {
        // User is logged in with Firebase Auth - find their player doc
        try {
          const playersRef = collection(db, "players");
          const q = query(playersRef, where("authUid", "==", firebaseUser.uid));
          const snap = await getDocs(q);
          
          if (!snap.empty) {
            const playerDoc = snap.docs[0];
            setPlayer({ id: playerDoc.id, ...playerDoc.data() } as PlayerDoc);
            setNeedsSetup(false);
          } else {
            // Auth user exists but no linked player - shouldn't happen in normal flow
            setPlayer(null);
            setNeedsSetup(false);
          }
        } catch (e) {
          console.error("Error fetching player doc:", e);
          setPlayer(null);
        }
      } else {
        // Check if there's a temp-logged-in player in session storage
        const tempPlayerId = sessionStorage.getItem("tempPlayerId");
        if (tempPlayerId) {
          try {
            const playerDoc = await getDoc(doc(db, "players", tempPlayerId));
            if (playerDoc.exists()) {
              const data = playerDoc.data() as Omit<PlayerDoc, "id">;
              // Only restore if they still need setup (have tempPassword)
              if (data.tempPassword) {
                setPlayer({ id: playerDoc.id, ...data });
                setNeedsSetup(true);
              } else {
                // Player has completed setup, clear temp session
                sessionStorage.removeItem("tempPlayerId");
                setPlayer(null);
                setNeedsSetup(false);
              }
            }
          } catch (e) {
            console.error("Error restoring temp session:", e);
            sessionStorage.removeItem("tempPlayerId");
          }
        } else {
          setPlayer(null);
          setNeedsSetup(false);
        }
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Login with username + temp password
  const loginWithUsername = useCallback(async (
    username: string, 
    password: string, 
    _rememberMe: boolean  // Not used for temp login (session-only until account setup)
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Normalize username (lowercase, no spaces)
      const normalizedUsername = username.toLowerCase().replace(/\s+/g, "");
      
      // Find player by username
      const playersRef = collection(db, "players");
      const q = query(playersRef, where("username", "==", normalizedUsername));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        return { success: false, error: "Username not found" };
      }
      
      const playerDoc = snap.docs[0];
      const playerData = playerDoc.data() as Omit<PlayerDoc, "id">;
      
      // Check if player already has auth set up (should use email login)
      if (playerData.authUid && !playerData.tempPassword) {
        return { success: false, error: "Please login with your email and password" };
      }
      
      // Validate temp password
      if (playerData.tempPassword !== password) {
        return { success: false, error: "Incorrect password" };
      }
      
      // Success - set player in state and session storage
      const fullPlayer = { id: playerDoc.id, ...playerData };
      setPlayer(fullPlayer);
      setNeedsSetup(true);
      
      // Store in session storage for page refreshes during setup
      sessionStorage.setItem("tempPlayerId", playerDoc.id);
      
      return { success: true };
    } catch (e: any) {
      console.error("Login error:", e);
      return { success: false, error: e.message || "Login failed" };
    }
  }, []);

  // Login with email + password
  const loginWithEmail = useCallback(async (
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
      console.error("Email login error:", e);
      
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

  // Set up permanent account after temp login
  const setupAccount = useCallback(async (
    email: string, 
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!player) {
      return { success: false, error: "No player session found" };
    }
    
    // Validate password length
    if (password.length < 4) {
      return { success: false, error: "Password must be at least 4 characters" };
    }
    
    try {
      // Create Firebase Auth account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;
      
      // Update player doc with authUid, email, and clear tempPassword
      await updateDoc(doc(db, "players", player.id), {
        authUid: uid,
        email: email,
        tempPassword: null // Clear temp password
      });
      
      // Clear temp session storage
      sessionStorage.removeItem("tempPlayerId");
      
      // Update local state
      setPlayer({ ...player, authUid: uid, email, tempPassword: undefined });
      setNeedsSetup(false);
      setUser(userCredential.user);
      
      // Set local persistence for future logins
      await setPersistence(auth, browserLocalPersistence);
      
      return { success: true };
    } catch (e: any) {
      console.error("Setup account error:", e);
      
      // Friendly error messages
      if (e.code === "auth/email-already-in-use") {
        return { success: false, error: "This email is already registered" };
      }
      if (e.code === "auth/invalid-email") {
        return { success: false, error: "Invalid email address" };
      }
      if (e.code === "auth/weak-password") {
        return { success: false, error: "Password must be at least 4 characters" };
      }
      
      return { success: false, error: e.message || "Account setup failed" };
    }
  }, [player]);

  // Logout
  const logout = useCallback(async () => {
    try {
      // Clear temp session
      sessionStorage.removeItem("tempPlayerId");
      
      // Sign out of Firebase Auth
      await signOut(auth);
      
      // Clear local state
      setUser(null);
      setPlayer(null);
      setNeedsSetup(false);
    } catch (e) {
      console.error("Logout error:", e);
    }
  }, []);

  // Check if current player can edit a match
  const canEditMatch = useCallback((teamAPlayerIds: string[], teamBPlayerIds: string[]): boolean => {
    // Must be logged in
    if (!player) return false;
    
    // Must have completed account setup (no needsSetup)
    if (needsSetup) return false;
    
    // Must be rostered in this match
    const allPlayerIds = [...teamAPlayerIds, ...teamBPlayerIds];
    return allPlayerIds.includes(player.id);
  }, [player, needsSetup]);

  const value: AuthContextType = {
    user,
    player,
    loading,
    needsSetup,
    loginWithUsername,
    loginWithEmail,
    setupAccount,
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
