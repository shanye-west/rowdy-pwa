import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Layout from "../components/Layout";

export default function Login() {
  const navigate = useNavigate();
  const { login, resetPassword, player } = useAuth();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  // If already logged in, redirect home
  if (player) {
    navigate("/", { replace: true });
    return null;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (!email.trim()) {
      setError("Please enter your email");
      setLoading(false);
      return;
    }

    if (!password) {
      setError("Please enter your password");
      setLoading(false);
      return;
    }

    try {
      const result = await login(email.trim(), password, rememberMe);

      if (!result.success) {
        setError(result.error || "Login failed");
      }
      // If successful, onAuthStateChanged will set player and trigger redirect
    } catch (e: any) {
      setError(e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (!email.trim()) {
      setError("Please enter your email");
      setLoading(false);
      return;
    }

    try {
      const result = await resetPassword(email.trim());

      if (result.success) {
        setSuccess("Password reset email sent! Check your inbox.");
        setShowForgotPassword(false);
      } else {
        setError(result.error || "Failed to send reset email");
      }
    } catch (e: any) {
      setError(e.message || "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout title="Login" showBack>
      <div style={{ padding: "1rem", maxWidth: 400, margin: "0 auto" }}>
        
        {/* Help Text */}
        <p style={{ 
          fontSize: "0.875rem", 
          color: "var(--text-muted, #6b7280)", 
          marginBottom: "1.5rem",
          textAlign: "center"
        }}>
          {showForgotPassword 
            ? "Enter your email to receive a password reset link."
            : "Login with your email and password."
          }
        </p>

        {showForgotPassword ? (
          // Forgot Password Form
          <form onSubmit={handleForgotPassword}>
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

            {/* Success Message */}
            {success && (
              <div style={{
                padding: "0.75rem",
                marginBottom: "1rem",
                borderRadius: 8,
                background: "#f0fdf4",
                color: "#16a34a",
                fontSize: "0.875rem",
                textAlign: "center"
              }}>
                {success}
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
                transition: "background 0.2s",
                marginBottom: "1rem"
              }}
            >
              {loading ? "Sending..." : "Send Reset Email"}
            </button>

            {/* Back to Login */}
            <button
              type="button"
              onClick={() => { setShowForgotPassword(false); setError(""); setSuccess(""); }}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: 8,
                border: "1px solid var(--border-color, #e5e7eb)",
                background: "transparent",
                color: "var(--text-primary)",
                fontWeight: 500,
                fontSize: "0.875rem",
                cursor: "pointer"
              }}
            >
              Back to Login
            </button>
          </form>
        ) : (
          // Login Form
          <form onSubmit={handleLogin}>
            {/* Email Input */}
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
                placeholder="Enter your password"
                autoComplete="current-password"
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

            {/* Remember Me */}
            <div style={{ marginBottom: "1rem" }}>
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

            {/* Success Message */}
            {success && (
              <div style={{
                padding: "0.75rem",
                marginBottom: "1rem",
                borderRadius: 8,
                background: "#f0fdf4",
                color: "#16a34a",
                fontSize: "0.875rem",
                textAlign: "center"
              }}>
                {success}
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
                transition: "background 0.2s",
                marginBottom: "1rem"
              }}
            >
              {loading ? "Logging in..." : "Login"}
            </button>

            {/* Forgot Password Link */}
            <button
              type="button"
              onClick={() => { setShowForgotPassword(true); setError(""); setSuccess(""); }}
              style={{
                width: "100%",
                padding: "0.5rem",
                background: "transparent",
                border: "none",
                color: "var(--brand-primary, #2563eb)",
                fontSize: "0.875rem",
                cursor: "pointer",
                textDecoration: "underline"
              }}
            >
              Forgot password?
            </button>
          </form>
        )}
      </div>
    </Layout>
  );
}
