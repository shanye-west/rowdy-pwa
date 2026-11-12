/** Browser-specific Home Screen steps, with an optional video walkthrough. */

import { useState, type ReactNode } from "react";
import { Download, Share, SquarePlus, Check, ChevronDown, type LucideProps } from "lucide-react";
import { Modal } from "./Modal";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { isIOS, isStandalone, iosBrowser } from "../messaging";

const SAFARI_VIDEO = "/videos/rowdy_cup_pwa_home_screen_safari_annotated_corrected_noaudio.mp4";
const CHROME_VIDEO = "/videos/rowdy_cup_pwa_home_screen_app_annotated_cropped_noaudio.mp4";

function SafariMenuIcon(props: LucideProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

export function InstallGuideModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { canInstall, promptInstall } = useInstallPrompt();
  // Default the iOS clip to the user's current browser; let them switch if we
  // guessed wrong (UA sniffing misses in-app webviews, Firefox/Edge, etc.).
  const [iosVideo, setIosVideo] = useState<"safari" | "chrome">(
    iosBrowser() === "chrome" ? "chrome" : "safari"
  );

  const [showVideo, setShowVideo] = useState(false);

  const handleNativeInstall = async () => {
    await promptInstall();
    onClose();
  };

  let body: ReactNode;
  if (isStandalone()) {
    body = (
      <p className="text-center text-sm text-muted-foreground">
        You're all set — Rowdy Cup is already installed on this device.
      </p>
    );
  } else if (canInstall) {
    body = (
      <>
        <p className="mb-4 text-center text-sm text-muted-foreground">
          Keep Rowdy Cup one tap away with its own Home Screen icon.
        </p>
        <button
          type="button"
          onClick={handleNativeInstall}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 px-4 text-base font-semibold text-primary-foreground transition-transform active:scale-95"
        >
          <Download className="h-5 w-5" />
          Install app
        </button>
      </>
    );
  } else if (isIOS()) {
    body = (
      <>
        <p className="mb-3 text-center text-sm text-muted-foreground">
          Add Rowdy Cup in {iosVideo === "safari" ? "five" : "four"} steps, then open it from your Home Screen.
        </p>
        <div className="mb-4 flex justify-center gap-2" aria-label="Browser instructions">
          {(["safari", "chrome"] as const).map(browser => (
            <button key={browser} type="button" aria-pressed={iosVideo === browser}
              onClick={() => { setIosVideo(browser); setShowVideo(false); }}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${iosVideo === browser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
              {browser === "safari" ? "Safari" : "Chrome"}
            </button>
          ))}
        </div>
        {iosBrowser() === "other" && <p className="mb-3 text-sm text-muted-foreground">Open app.rowdycup.com in Safari or Chrome first, then follow the matching steps below.</p>}
        <ol className="space-y-3">
          {[
            ...(iosVideo === "safari" ? [{ Icon: SafariMenuIcon, title: "Open Safari’s menu", text: "Tap the three horizontal lines (the bottom line is shorter) to the left of the address bar at the bottom of the screen. If your Safari layout already shows Share, skip to the next step." }] : []),
            {
              Icon: Share, title: "Tap Share", text: iosVideo === "chrome"
                ? "Find the Share icon on the right of Chrome’s address bar."
                : "Tap Share in the menu — the square with an upward arrow."
            },
            { Icon: ChevronDown, title: "Tap View More", text: "Tap View More to reveal the rest of the Share menu. If the full list is already visible, continue to the next step." },
            { Icon: SquarePlus, title: "Choose Add to Home Screen", text: "Find Add to Home Screen in the expanded list. If it’s missing, check Edit Actions." },
            { Icon: Check, title: "Tap Add", text: "Keep the name Rowdy Cup. If you see Open as Web App, leave it switched on." },
          ].map(({ Icon, title, text }, index) => (
            <li key={title} className="flex gap-3 rounded-xl border border-border p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon aria-hidden="true" className="h-5 w-5 text-primary" /></div>
              <div><p className="text-sm font-semibold">{index + 1}. {title}</p><p className="mt-1 text-xs text-muted-foreground">{text}</p></div>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-blue-50 p-3">
          <img src="/pwa-192x192.png" alt="Rowdy Cup app icon" className="h-11 w-11 rounded-xl" />
          <p className="text-sm font-medium text-foreground">Now go to your Home Screen and tap the Rowdy Cup icon to open the app.</p>
        </div>
        <button type="button" aria-expanded={showVideo} aria-controls="install-video"
          onClick={() => setShowVideo(v => !v)} className="mt-4 w-full text-center text-sm font-semibold text-primary">
          {showVideo ? "Hide walkthrough" : "Watch walkthrough"}
        </button>
        {showVideo && iosVideo === "safari" && <p className="mt-2 text-xs text-muted-foreground">This video shows an earlier Safari layout. Follow the steps above for the current menu.</p>}
        {showVideo && <video id="install-video" key={iosVideo}
          src={iosVideo === "chrome" ? CHROME_VIDEO : SAFARI_VIDEO}
          muted playsInline controls preload="metadata"
          className="mx-auto mt-3 max-h-[45vh] w-auto rounded-lg border border-border/60" />}

      </>
    );
  } else {
    body = (
      <p className="text-center text-sm text-muted-foreground">
        Open <strong>app.rowdycup.com</strong> in your phone's browser (Safari or Chrome on iPhone)
        to add Rowdy Cup to your Home Screen.
      </p>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={() => { setShowVideo(false); onClose(); }} title="Add Rowdy to Home Screen" ariaLabel="Install Rowdy Cup">
      {isOpen && (
        <>
          {body}
          <button
            type="button"
            onClick={() => { setShowVideo(false); onClose(); }}
            className="mt-5 w-full rounded-lg bg-muted py-2.5 px-4 text-sm font-semibold text-foreground transition-transform active:scale-95"
          >
            Close guide
          </button>
        </>
      )}
    </Modal>
  );
}
