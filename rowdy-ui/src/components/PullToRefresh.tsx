import React, { useState, useCallback } from 'react';

interface PullToRefreshProps {
  children: React.ReactNode;
  /** Optional callback when refresh is triggered. If not provided, just shows visual feedback. */
  onRefresh?: () => void | Promise<void>;
}

/**
 * Pull-to-refresh component.
 * Since we use real-time Firestore listeners, this mostly provides visual feedback
 * that data is "fresh" rather than actually reloading the page.
 */
export default function PullToRefresh({ children, onRefresh }: PullToRefreshProps) {
  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Threshold to trigger refresh (in pixels)
  const THRESHOLD = 80;
  const MAX_PULL = 140;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Allow pull if we are at the top (or very close to it)
    if (window.scrollY <= 5) {
      setStartY(e.touches[0].clientY);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY === 0) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;

    // Only allow pulling down, and only if we are at the top
    if (diff > 0 && window.scrollY <= 5) {
      // Add resistance (logarithmic feel)
      const damped = Math.min(diff * 0.5, MAX_PULL); 
      setPullDistance(damped);
    }
  }, [startY]);

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance > THRESHOLD) {
      // Attempt haptic feedback
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(50); 
      }

      setRefreshing(true);
      
      // Call the refresh callback if provided
      if (onRefresh) {
        try {
          await onRefresh();
        } catch (e) {
          console.error("Refresh failed:", e);
        }
      }
      
      // Show refreshed state briefly, then reset
      setTimeout(() => {
        setRefreshing(false);
        setPullDistance(0);
        setStartY(0);
      }, 800);
    } else {
      // Snap back if not pulled far enough
      setPullDistance(0);
      setStartY(0);
    }
  }, [pullDistance, onRefresh]);

  // Determine styling based on state
  const style = {
    transform: `translateY(${refreshing ? THRESHOLD : pullDistance}px)`,
    transition: refreshing || pullDistance === 0 ? 'transform 0.3s ease-out' : 'none',
  };

  // Helper to determine label
  const isReadyToRefresh = pullDistance > THRESHOLD;

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ minHeight: '100vh' }} 
    >
      {/* REFRESH INDICATOR */}
      <div style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        height: `${THRESHOLD}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 12,
        pointerEvents: 'none',
        zIndex: 0,
        opacity: pullDistance > 0 || refreshing ? 1 : 0,
        transform: `translateY(${pullDistance > 0 || refreshing ? 0 : -50}px)`,
        transition: 'opacity 0.2s, transform 0.2s'
      }}>
        {/* Icon */}
        <svg 
          width="24" 
          height="24" 
          viewBox="0 0 24 24" 
          style={{ 
            animation: refreshing ? 'spin 1s linear infinite' : 'none',
            color: isReadyToRefresh ? 'var(--brand-primary)' : '#94a3b8',
            transform: refreshing ? 'none' : `rotate(${pullDistance * 3}deg)`,
            transition: 'color 0.2s'
          }}
        >
          <path fill="currentColor" d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8Z" />
          <path fill="currentColor" opacity="0.3" d="M12 22v-2a8 8 0 0 1-8-8H2a10 10 0 0 0 10 10Z" />
          <path fill="currentColor" opacity="0.3" d="M22 12h-2a8 8 0 0 1-8 8v2a10 10 0 0 0 10-10Z" />
          <path fill="currentColor" opacity="0.3" d="M12 2v2a8 8 0 0 1 8 8h2a10 10 0 0 0-10-10Z" />
        </svg>

        {/* Text Feedback */}
        {!refreshing && (
          <span style={{ 
            fontSize: '0.75rem', 
            fontWeight: 600, 
            marginTop: 4, 
            color: isReadyToRefresh ? 'var(--brand-primary)' : '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            {isReadyToRefresh ? "Release to refresh" : "Pull down"}
          </span>
        )}
      </div>

      {/* APP CONTENT */}
      <div style={style}>
        {children}
      </div>

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}