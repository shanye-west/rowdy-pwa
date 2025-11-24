import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

type LayoutProps = {
  title: string;
  tournamentName?: string; // Used to detect theme
  showBack?: boolean;
  children: React.ReactNode;
};

export default function Layout({ title, tournamentName, showBack, children }: LayoutProps) {
  const navigate = useNavigate();

  // --- THEME ENGINE ---
  useEffect(() => {
    // Check if "Christmas" is in the tournament name
    const isChristmas = tournamentName?.toLowerCase().includes("christmas");
    
    if (isChristmas) {
      document.body.classList.add("theme-christmas");
    } else {
      document.body.classList.remove("theme-christmas");
    }
  }, [tournamentName]);

  return (
    <>
      {/* STICKY HEADER */}
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          {showBack && (
            <button onClick={() => navigate(-1)} className="btn-back" aria-label="Go Back">
              {/* Simple Chevron Left Icon */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <div className="header-title">{title}</div>
        </div>
        
        {/* Placeholder for right-side menu (optional) */}
        <div style={{ width: 24 }}></div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="app-container">
        {children}
      </main>
    </>
  );
}