import React, { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import PullToRefresh from "./PullToRefresh";
import OfflineImage from "./OfflineImage";
import { useAuth } from "../contexts/AuthContext";
import { useOnlineStatusWithHistory } from "../hooks/useOnlineStatus";

type LayoutProps = {
  title: string;
  series?: string; // "rowdyCup" | "christmasClassic"
  showBack?: boolean;
  tournamentLogo?: string;
  children: React.ReactNode;
};

export default function Layout({ title, series, showBack, tournamentLogo, children }: LayoutProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { player, logout, loading: authLoading } = useAuth();
  const { isOnline, wasOffline } = useOnlineStatusWithHistory();

  // Parse title to extract year (if present at start) and main name
  const { year, mainTitle } = useMemo(() => {
    const match = title.match(/^(\d{4})\s+(.+)$/);
    if (match) {
      return { year: match[1], mainTitle: match[2] };
    }
    return { year: null, mainTitle: title };
  }, [title]);

  // --- THEME ENGINE ---
  useEffect(() => {
    if (series === "christmasClassic") {
      document.body.classList.add("theme-christmas");
    } else {
      document.body.classList.remove("theme-christmas");
    }
  }, [series]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = () => setMenuOpen(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [menuOpen]);

  return (
    <>
      {/* STICKY HEADER */}
      <header className="app-header">
        {/* Left: Back Button (if shown) + Tournament Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {showBack && (
            <button onClick={() => navigate(-1)} className="btn-back" aria-label="Go Back">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <Link to="/" aria-label="Home">
            <OfflineImage 
              src={tournamentLogo} 
              alt="Tournament Logo"
              fallbackIcon="⛳"
              fallbackSrc={
                series === "christmasClassic" 
                  ? "/images/rowdycup-logo-christmas.svg" 
                  : "/images/rowdycup-logo.svg"
              }
              style={{ height: 44, width: 44, objectFit: "contain" }} 
            />
          </Link>
        </div>

        {/* Center: Tournament Title (year small on top, main title below) */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, textAlign: "center", lineHeight: 1.1 }}>
          {year && (
            <div style={{ fontSize: "0.65rem", fontWeight: 600, opacity: 0.85, letterSpacing: "0.05em" }}>
              {year}
            </div>
          )}
          <div style={{ fontSize: "1rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {mainTitle}
          </div>
        </div>

        {/* Right: Hamburger Menu */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", minWidth: 48, position: "relative" }}>
          {/* menu toggle */}
          <button 
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }} 
            className="btn-back" 
            aria-label="Menu"
            style={{ padding: 8 }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <div 
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 8,
                background: "white",
                borderRadius: 8,
                boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                minWidth: 180,
                zIndex: 100,
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Auth Status Section */}
              {!authLoading && player && (
                <div style={{ 
                  padding: "12px 16px", 
                  background: "#f8fafc", 
                  borderBottom: "1px solid #e2e8f0",
                  fontSize: "0.875rem"
                }}>
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>
                    {player.displayName}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                    {player.email || "Logged in"}
                  </div>
                </div>
              )}
              
              <Link 
                to="/" 
                style={{ display: "block", padding: "12px 16px", color: "#0f172a", textDecoration: "none", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}
                onClick={() => setMenuOpen(false)}
              >
                Home
              </Link>
              <Link 
                to="/teams" 
                style={{ display: "block", padding: "12px 16px", color: "#0f172a", textDecoration: "none", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}
                onClick={() => setMenuOpen(false)}
              >
                Team Rosters
              </Link>
              <Link 
                to="/history" 
                style={{ display: "block", padding: "12px 16px", color: "#0f172a", textDecoration: "none", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}
                onClick={() => setMenuOpen(false)}
              >
                History
              </Link>
              
              {/* Auth Actions */}
              {!authLoading && (
                <>
                  {player ? (
                    <button
                      onClick={async () => {
                        setMenuOpen(false);
                        await logout();
                        setShowLogoutConfirm(true);
                        setTimeout(() => setShowLogoutConfirm(false), 3000);
                        navigate("/");
                      }}
                      style={{ 
                        display: "block", 
                        width: "100%", 
                        padding: "12px 16px", 
                        color: "#dc2626", 
                        textDecoration: "none", 
                        fontWeight: 600,
                        background: "none",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: "1rem"
                      }}
                    >
                      Logout
                    </button>
                  ) : (
                    <Link 
                      to="/login" 
                      style={{ display: "block", padding: "12px 16px", color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
                      onClick={() => setMenuOpen(false)}
                    >
                      Login
                    </Link>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* WRAP CONTENT IN PULL-TO-REFRESH */}
      <PullToRefresh>
        {/* Offline Status Banner */}
        {!isOnline && (
          <div 
            style={{
              background: "#fbbf24",
              color: "#78350f",
              padding: "8px 16px",
              textAlign: "center",
              fontSize: "0.875rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>📶</span>
            <span>You're offline — changes will sync when connected</span>
          </div>
        )}
        
        {/* Back Online Banner (auto-dismisses after 3s) */}
        {wasOffline && isOnline && (
          <div 
            style={{
              background: "#22c55e",
              color: "white",
              padding: "8px 16px",
              textAlign: "center",
              fontSize: "0.875rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>✓</span>
            <span>Back online — syncing changes</span>
          </div>
        )}

        {/* Logout Confirmation Banner (auto-dismisses after 3s) */}
        {showLogoutConfirm && (
          <div 
            style={{
              background: "#3b82f6",
              color: "white",
              padding: "8px 16px",
              textAlign: "center",
              fontSize: "0.875rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>👋</span>
            <span>You've been logged out</span>
          </div>
        )}

        <main className="app-container">
          {children}
        </main>
      </PullToRefresh>
    </>
  );
}