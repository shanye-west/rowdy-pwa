export interface StatusBannerProps {
  error?: string | null;
  success?: string | null;
}

/** Standard error/success banner pair used across admin pages. */
export default function StatusBanner({ error, success }: StatusBannerProps) {
  if (!error && !success) return null;
  return (
    <>
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 text-sm">✓ {success}</p>
        </div>
      )}
    </>
  );
}
