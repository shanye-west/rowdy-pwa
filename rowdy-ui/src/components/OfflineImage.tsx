import { useState, useEffect, useCallback } from "react";
import type { ImgHTMLAttributes } from "react";

type OfflineImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fallbackIcon?: string; // Emoji or text to show when image fails
  fallbackText?: string; // Alt text for accessibility
  showFallback?: "always" | "offline" | "error"; // When to show fallback
  fallbackSrc?: string; // local/static fallback image to try when src fails
};

/**
 * An image component that gracefully handles offline/error states.
 * Shows a styled fallback instead of the browser's broken image icon.
 */
export default function OfflineImage({
  src,
  alt,
  fallbackIcon = "🏌️",
  fallbackText,
  showFallback = "error",
  style,
  className,
  fallbackSrc,
  loading,
  decoding,
  ...rest
}: OfflineImageProps) {
  // Opt-in lazy loading: when the caller asks for loading="lazy", skip the eager
  // Image() preloader (and CriOS prefetch) below and let the native <img> defer
  // the network request until it scrolls near the viewport. Default callers are
  // unaffected and keep the reliable preload behavior.
  const isLazy = loading === "lazy";
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [displayedSrc, setDisplayedSrc] = useState<string | undefined>(src);
  const [triedFallbackSrc, setTriedFallbackSrc] = useState(false);
  const [effectiveSrc, setEffectiveSrc] = useState<string | undefined>(src);

  // Reset state when src changes
  useEffect(() => {
    setHasError(false);
    setIsLoaded(false);
    setDisplayedSrc(src);
    setTriedFallbackSrc(false);
  }, [src]);

  // Ref callback to handle already-cached images (onLoad fires before React attaches handler)
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalHeight > 0) {
      setIsLoaded(true);
      // cached image: mark loaded
    }
  }, []);

  // Preload displayedSrc via Image() to ensure load events fire reliably
  useEffect(() => {
    if (!displayedSrc) return;
    if (isLazy) return; // lazy images load natively when scrolled into view
    let cancelled = false;
    const loader = new Image();
    try {
      // preload start
    } catch (e) {}
    loader.src = displayedSrc;
    loader.onload = () => {
      if (cancelled) return;
      setIsLoaded(true);
      setHasError(false);
      // preload onload
    };
    loader.onerror = () => {
      if (cancelled) return;
      // preload onerror
      // Try fallbackSrc once if available and not already tried
      if (fallbackSrc && !triedFallbackSrc && displayedSrc !== fallbackSrc) {
        setTriedFallbackSrc(true);
        setDisplayedSrc(fallbackSrc);
        setHasError(false);
        setIsLoaded(false);
      } else {
        setHasError(true);
      }
    };
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedSrc]);

  // Keep effectiveSrc in sync with displayedSrc by default
  useEffect(() => {
    setEffectiveSrc(displayedSrc);
  }, [displayedSrc]);

  // On iOS Chrome (CriOS) some cached images / service-worker races occur.
  // Workaround: fetch the image via fetch() with no-store and convert to blob URL,
  // then use the blob URL as the <img> src to avoid SW/cache race issues.
  useEffect(() => {
    const isCriOS = typeof navigator !== 'undefined' && /CriOS/.test(navigator.userAgent || '');
    if (!isCriOS) return;
    if (isLazy) return; // don't eagerly prefetch lazy images
    if (!displayedSrc) return;
    if (!/^https?:\/\//.test(displayedSrc)) return; // only remote http(s) URLs

    let cancelled = false;
    const controller = new AbortController();
    let objUrl: string | undefined;
    (async () => {
      try {
        // fetch start (CriOS workaround)
        const resp = await fetch(displayedSrc, { cache: 'no-store', signal: controller.signal });
        if (!resp.ok) throw new Error(`fetch status ${resp.status}`);
        const blob = await resp.blob();
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);
        setEffectiveSrc(objUrl);
        // fetch onload (CriOS)
      } catch (err) {
        // fetch error (CriOS)
        // Leave effectiveSrc as-is; the Image preloader will attempt fallbackSrc if needed
      }
    })();

    return () => { cancelled = true; controller.abort(); if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [displayedSrc, isLazy]);

  // Log render state for debugging
  useEffect(() => {
    // render state (debug removed)
  }, [displayedSrc, isLoaded, hasError, triedFallbackSrc]);

  // If no src provided, but a fallbackSrc exists, try it; otherwise show fallback
  // If no src provided, try fallbackSrc via effect (avoid setState during render)
  useEffect(() => {
    if (!displayedSrc) {
      if (fallbackSrc) {
        setDisplayedSrc(fallbackSrc);
      }
    }
  }, [displayedSrc, fallbackSrc]);

  // If still no displayedSrc (and no fallback), show fallback display immediately
  if (!displayedSrc) {
    return (
      <FallbackDisplay
        icon={fallbackIcon}
        text={fallbackText || alt}
        style={style}
        className={className}
      />
    );
  }

  // If error occurred, show fallback icon
  if (hasError) {
    return (
      <FallbackDisplay
        icon={fallbackIcon}
        text={fallbackText || alt}
        style={style}
        className={className}
      />
    );
  }

  return (
    <img
      ref={imgRef}
      src={effectiveSrc}
      alt={alt}
      loading={loading}
      decoding={decoding ?? "async"}
      style={{
        ...style,
        // Hide until loaded to prevent flash of broken image
        opacity: isLoaded ? 1 : 0,
        transition: "opacity 0.2s ease",
      }}
      className={className}
      onLoad={() => setIsLoaded(true)}
      onError={() => {
        // Try fallbackSrc once before showing the icon fallback
        if (fallbackSrc && !triedFallbackSrc && displayedSrc !== fallbackSrc) {
          setTriedFallbackSrc(true);
          setDisplayedSrc(fallbackSrc);
          setHasError(false);
          setIsLoaded(false);
        } else {
          setHasError(true);
        }
      }}
      {...rest}
    />
  );
}

/**
 * Styled fallback display with icon/emoji
 */
function FallbackDisplay({
  icon,
  text,
  style,
  className,
}: {
  icon: string;
  text?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  // Extract dimensions from style for fallback sizing
  const width = style?.width || style?.minWidth || 48;
  const height = style?.height || style?.minHeight || 48;

  return (
    <div
      className={className}
      style={{
        ...style,
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-hover, #f1f5f9)",
        borderRadius: 8,
        fontSize: typeof width === "number" ? Math.max(width * 0.4, 16) : 20,
      }}
      role="img"
      aria-label={text || "Image unavailable"}
      title={text || "Image unavailable"}
    >
      {icon}
    </div>
  );
}
