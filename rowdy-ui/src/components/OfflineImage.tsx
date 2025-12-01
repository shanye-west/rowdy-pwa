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
  ...rest
}: OfflineImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [displayedSrc, setDisplayedSrc] = useState<string | undefined>(src);
  const [triedFallbackSrc, setTriedFallbackSrc] = useState(false);

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
    }
  }, []);

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
      src={displayedSrc}
      alt={alt}
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
