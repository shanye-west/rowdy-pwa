import React, { useState, useRef } from 'react';

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Threshold to trigger refresh (in pixels)
  const THRESHOLD = 80;
  const MAX_PULL = 120;

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only enable pull if we are at the very top of the page
    if (window.scrollY === 0) {
      setStartY(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // If we haven't started a valid pull, ignore
    if (startY === 0) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;

    // Only allow pulling down, and only if we are at the top
    if (diff > 0 && window.scrollY === 0) {
      // Add resistance (logarithmic feel) so you can't pull down forever
      const damped = Math.min(diff * 0.5, MAX_PULL); 
      setPullDistance(damped);
      
      // Prevent default browser scrolling while pulling to refresh
      // (Note: e.preventDefault() inside passive listeners is restricted in some browsers,
      // but CSS 'overscroll-behavior' handles most of this logic now)
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > THRESHOLD) {
      setRefreshing(true);
      // Trigger the refresh
      setTimeout(() => {
        window.location.reload();
      }, 500); // Small delay to let the user see the spinner
    } else {
      // Snap back if not pulled far enough
      setPullDistance(0);
      setStartY(0);
    }
  };

  // Determine styling based on state
  const style = {
    transform: `translateY(${refreshing ? THRESHOLD : pullDistance}px)`,
    transition: refreshing || pullDistance === 0 ? 'transform 0.3s ease-out' : 'none',
  };

  return (
    <div 
      ref={contentRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ minHeight: '100vh' }} // Ensure it fills screen to catch touches
    >
      {/* LOADING SPINNER INDICATOR */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: `${THRESHOLD}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 0,
        opacity: pullDistance > 0 || refreshing ? 1 : 0,
        transform: `translateY(${pullDistance > 0 || refreshing ? 0 : -50}px)`,
        transition: 'opacity 0.2s, transform 0.2s'
      }}>
        <svg 
          width="24" 
          height="24" 
          viewBox="0 0 24 24" 
          style={{ 
            animation: 'spin 1s linear infinite',
            color: 'var(--brand-primary)', // Uses your Theme color!
            transform: `rotate(${pullDistance * 3}deg)` // Rotates as you pull
          }}
        >
          <path fill="currentColor" d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8Z" />
          <path fill="currentColor" opacity="0.3" d="M12 22v-2a8 8 0 0 1-8-8H2a10 10 0 0 0 10 10Z" />
          <path fill="currentColor" opacity="0.3" d="M22 12h-2a8 8 0 0 1-8 8v2a10 10 0 0 0 10-10Z" />
          <path fill="currentColor" opacity="0.3" d="M12 2v2a8 8 0 0 1 8 8h2a10 10 0 0 0-10-10Z" />
        </svg>
      </div>

      {/* APP CONTENT */}
      <div style={style}>
        {children}
      </div>

      {/* GLOBAL SPINNER KEYFRAMES */}
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}