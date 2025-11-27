import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Layout from "../components/Layout";

type LoginMode = "username" | "email";

export default function Login() {
  const navigate = useNavigate();
  const { loginWithUsername, loginWithEmail, player, needsSetup } = useAuth();
  
  const [mode, setMode] = useState<LoginMode>("username");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If already logged in and needs setup, redirect to setup
  if (player && needsSetup) {
    navigate("/setup", { replace: true });
    return null;
  }

  // If fully logged in, redirect home
  if (player && !needsSetup) {
    navigate("/", { replace: true });
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      let result;
      
      if (mode === "username") {
        if (!username.trim()) {
          setError("Please enter your username");
          setLoading(false);
          return;
        }
        result = await loginWithUsername(username.trim(), password, rememberMe);
      } else {
        if (!email.trim()) {
          setError("Please enter your email");
          setLoading(false);
          return;
        }
        result = await loginWithEmail(email.trim(), password, rememberMe);
      }

      if (result.success) {
        // loginWithUsername sets needsSetup=true, so we'll redirect to setup
        // loginWithEmail for returning users will redirect home
        if (mode === "username") {
          navigate("/setup", { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      } else {
        setError(result.error || "Login failed");
      }
    } catch (e: any) {
      setError(e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout title="Login" showBack>
      <div style={{ padding: "1rem", maxWidth: 400, margin: "0 auto" }}>
        {/* Mode Tabs */}
        <div style={{ 
          display: "flex", 
          borderRadius: 8, 
          overflow: "hidden",
          marginBottom: "1.5rem",
          border: "1px solid var(--border-color, #e5e7eb)"
        }}>
          <button
            type="button"
            onClick={() => { setMode("username"); setError(""); }}
            style={{
              flex: 1,
              padding: "0.75rem",
              border: "none",
              background: mode === "username" ? "var(--brand-primary, #2563eb)" : "transparent",
              color: mode === "username" ? "white" : "inherit",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Username
          </button>
          <button
            type="button"
            onClick={() => { setMode("email"); setError(""); }}
            style={{
              flex: 1,
              padding: "0.75rem",
              border: "none",
              background: mode === "email" ? "var(--brand-primary, #2563eb)" : "transparent",
              color: mode === "email" ? "white" : "inherit",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Email
          </button>
        </div>

        {/* Help Text */}
        <p style={{ 
          fontSize: "0.875rem", 
          color: "var(--text-muted, #6b7280)", 
          marginBottom: "1rem",
          textAlign: "center"
        }}>
          {mode === "username" 
            ? "First time? Use your username and the password provided."
            : "Returning? Login with your email and password."
          }
        </p>

        <form onSubmit={handleSubmit}>
          {/* Username or Email Input */}
          {mode === "username" ? (
            <div style={{ marginBottom: "1rem" }}>
              <label 
                htmlFor="username" 
                style={{ 
                  display: "block", 
                  marginBottom: "0.5rem", 
                  fontWeight: 500,
                  fontSize: "0.875rem"
                }}
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="firstnamelastname"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: 8,
                  border: "1px solid var(--border-color, #e5e7eb)",
                  fontSize: "1rem",
                  boxSizing: "border-box"
                }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: "1rem" }}>
              <label 
                htmlFor="email" 
                style={{ 
                  display: "block", 
                  marginBottom: "0.5rem", 
                  fontWeight: 500,
                  fontSize: "0.875rem"
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoCapitalize="none"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: 8,
                  border: "1px solid var(--border-color, #e5e7eb)",
                  fontSize: "1rem",
                  boxSizing: "border-box"
                }}
              />
            </div>
          )}

          {/* Password Input */}
          <div style={{ marginBottom: "1rem" }}>
            <label 
              htmlFor="password" 
              style={{ 
                display: "block", 
                marginBottom: "0.5rem", 
                fontWeight: 500,
                fontSize: "0.875rem"
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "username" ? "Enter temp password" : "Enter your password"}
              autoComplete={mode === "username" ? "off" : "current-password"}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: 8,
                border: "1px solid var(--border-color, #e5e7eb)",
                fontSize: "1rem",
                boxSizing: "border-box"
              }}
            />
          </div>

          {/* Remember Me (only for email login) */}
          {mode === "email" && (
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ fontSize: "0.875rem" }}>Remember me</span>
              </label>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={{
              padding: "0.75rem",
              marginBottom: "1rem",
              borderRadius: 8,
              background: "#fef2f2",
              color: "#dc2626",
              fontSize: "0.875rem",
              textAlign: "center"
            }}>
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.875rem",
              borderRadius: 8,
              border: "none",
              background: loading ? "#9ca3af" : "var(--brand-primary, #2563eb)",
              color: "white",
              fontWeight: 600,
              fontSize: "1rem",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.2s"
            }}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </Layout>
  );
}
