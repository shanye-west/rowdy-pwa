/**
 * Add-to-Home-Screen guide.
 *
 * Picks the right path for the device:
 *   - Native prompt available (Android / desktop Chromium) → one "Install app"
 *     button that fires the real OS prompt.
 *   - iPhone → a short, silent, annotated video of the Add-to-Home-Screen flow
 *     for the current browser. Safari and Chrome differ in install UI, so we
 *     autoplay the matching clip (auto-detected, with a manual switch in case we
 *     guessed wrong). Once installed it's all WebKit, so push works either way.
 *   - Anything else → a short "open it on your phone" fallback.
 *
 * Opened from the notifications flow when push needs an installed PWA, or from the
 * "Install app" menu item. See useInstallPrompt for the trigger plumbing.
 *
 * The video only mounts while the modal is open (it's a couple MB and isn't
 * precached), so closed it costs nothing.
 */

import { useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { isIOS, isStandalone, iosBrowser } from "../messaging";

const SAFARI_VIDEO = "/videos/rowdy_cup_pwa_home_screen_safari_annotated_corrected_noaudio.mp4";
const CHROME_VIDEO = "/videos/rowdy_cup_pwa_home_screen_app_annotated_cropped_noaudio.mp4";

export function InstallGuideModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { canInstall, promptInstall } = useInstallPrompt();
  // Default the iOS clip to the user's current browser; let them switch if we
  // guessed wrong (UA sniffing misses in-app webviews, Firefox/Edge, etc.).
  const [iosVideo, setIosVideo] = useState<"safari" | "chrome">(
    iosBrowser() === "chrome" ? "chrome" : "safari"
  );

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
          Install Rowdy Cup for notifications and a full-screen, app-like experience.
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
          To get notifications on iPhone, add Rowdy Cup to your Home Screen — follow along:
        </p>
        <video
          key={iosVideo}
          src={iosVideo === "chrome" ? CHROME_VIDEO : SAFARI_VIDEO}
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="auto"
          className="mx-auto max-h-[50vh] w-auto rounded-lg border border-border/60"
        />
        <button
          type="button"
          onClick={() => setIosVideo((v) => (v === "safari" ? "chrome" : "safari"))}
          className="mt-3 w-full text-center text-xs font-medium text-primary hover:underline"
        >
          {iosVideo === "safari"
            ? "Using Chrome instead? Show the Chrome steps"
            : "Using Safari instead? Show the Safari steps"}
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Then open Rowdy Cup from your Home Screen and turn on notifications.
        </p>
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
    <Modal isOpen={isOpen} onClose={onClose} title="Install Rowdy Cup" ariaLabel="Install Rowdy Cup">
      {isOpen && (
        <>
          {body}
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-lg bg-muted py-2.5 px-4 text-sm font-semibold text-foreground transition-transform active:scale-95"
          >
            Done
          </button>
        </>
      )}
    </Modal>
  );
}
