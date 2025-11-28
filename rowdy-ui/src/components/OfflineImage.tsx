import { useState, useEffect } from "react";
import type { ImgHTMLAttributes } from "react";

type OfflineImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fallbackIcon?: string; // Emoji or text to show when image fails
  fallbackText?: string; // Alt text for accessibility
  showFallback?: "always" | "offline" | "error"; // When to show fallback
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
  ...rest
}: OfflineImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Reset error state when src changes
  useEffect(() => {
    setHasError(false);
    setIsLoaded(false);
  }, [src]);

  // If no src provided, show fallback
  if (!src) {
    return (
      <FallbackDisplay
        icon={fallbackIcon}
        text={fallbackText || alt}
        style={style}
        className={className}
      />
    );
  }

  // If error occurred, show fallback
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
      src={src}
      alt={alt}
      style={{
        ...style,
        // Hide until loaded to prevent flash of broken image
        opacity: isLoaded ? 1 : 0,
        transition: "opacity 0.2s ease",
      }}
      className={className}
      onLoad={() => setIsLoaded(true)}
      onError={() => setHasError(true)}
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
