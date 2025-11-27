import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Layout from "../components/Layout";

export default function Setup() {
  const navigate = useNavigate();
  const { player, needsSetup, setupAccount, logout } = useAuth();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If not logged in or doesn't need setup, redirect
  if (!player) {
    navigate("/login", { replace: true });
    return null;
  }

  if (!needsSetup) {
    navigate("/", { replace: true });
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Validate email
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }

    // Basic email format check
    if (!email.includes("@") || !email.includes(".")) {
      setError("Please enter a valid email address");
      return;
    }

    // Validate password
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }

    // Confirm password match
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const result = await setupAccount(email.trim(), password);
      
      if (result.success) {
        navigate("/", { replace: true });
      } else {
        setError(result.error || "Setup failed");
      }
    } catch (e: any) {
      setError(e.message || "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <Layout title="Complete Setup" showBack={false}>
      <div style={{ padding: "1rem", maxWidth: 400, margin: "0 auto" }}>
        {/* Welcome Message */}
        <div style={{ 
          textAlign: "center", 
          marginBottom: "1.5rem",
          padding: "1rem",
          background: "var(--bg-secondary, #f9fafb)",
          borderRadius: 8
        }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Welcome, {player.displayName || player.username}!
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--text-muted, #6b7280)" }}>
            Set up your email and password to complete your account.
          </div>
        </div>

        <form onSubmit={handleSubmit}>
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
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #6b7280)", marginTop: "0.25rem" }}>
              You'll use this email to log in from now on
            </div>
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
              New Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              autoComplete="new-password"
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: 8,
                border: "1px solid var(--border-color, #e5e7eb)",
                fontSize: "1rem",
                boxSizing: "border-box"
              }}
            />
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #6b7280)", marginTop: "0.25rem" }}>
              Minimum 4 characters
            </div>
          </div>

          {/* Confirm Password Input */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label 
              htmlFor="confirmPassword" 
              style={{ 
                display: "block", 
                marginBottom: "0.5rem", 
                fontWeight: 500,
                fontSize: "0.875rem"
              }}
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              autoComplete="new-password"
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
            {loading ? "Setting up..." : "Complete Setup"}
          </button>

          {/* Logout Link */}
          <div style={{ textAlign: "center" }}>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted, #6b7280)",
                fontSize: "0.875rem",
                cursor: "pointer",
                textDecoration: "underline"
              }}
            >
              Wrong account? Log out
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
