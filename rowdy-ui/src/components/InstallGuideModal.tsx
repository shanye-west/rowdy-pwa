/**
 * Add-to-Home-Screen guide.
 *
 * Picks the right path for the device:
 *   - Native prompt available (Android / desktop Chromium) → one "Install app"
 *     button that fires the real OS prompt.
 *   - iOS Safari → illustrated Share → Add to Home Screen steps (iOS has no
 *     programmatic install).
 *   - Anything else → a short "open it on your phone" fallback.
 *
 * Opened from the notifications flow when push needs an installed PWA, or from the
 * "Install app" menu item. See useInstallPrompt for the trigger plumbing.
 */

import type { ReactNode } from "react";
import { Download, SquarePlus } from "lucide-react";
import { Modal } from "./Modal";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { isIOS, isStandalone } from "../messaging";

/** The iOS "Share" glyph (a tray with an up arrow) — matches Safari's toolbar. */
function IosShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

function Step({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n}
      </span>
      <span className="flex-1 text-sm text-foreground">{children}</span>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        {icon}
      </span>
    </li>
  );
}

export function InstallGuideModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { canInstall, promptInstall } = useInstallPrompt();

  const handleNativeInstall = async () => {
    await promptInstall();
    onClose();
  };

  let body: ReactNode;
  if (isStandalone()) {
    // Already installed — shouldn't usually open, but handle it gracefully.
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
        <p className="mb-4 text-center text-sm text-muted-foreground">
          To get notifications on iPhone, add Rowdy Cup to your Home Screen:
        </p>
        <ol className="space-y-3">
          <Step n={1} icon={<IosShareIcon className="h-5 w-5" />}>
            Tap the <strong>Share</strong> button in Safari's toolbar.
          </Step>
          <Step n={2} icon={<SquarePlus className="h-5 w-5" />}>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </Step>
          <Step n={3} icon={<span className="text-sm font-bold">Add</span>}>
            Tap <strong>Add</strong> in the top-right corner.
          </Step>
        </ol>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Then open Rowdy Cup from your Home Screen and turn on notifications.
        </p>
      </>
    );
  } else {
    body = (
      <p className="text-center text-sm text-muted-foreground">
        Open <strong>app.rowdycup.com</strong> in your phone's browser (Safari on iPhone, Chrome on
        Android) to install Rowdy Cup to your Home Screen.
      </p>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Install Rowdy Cup" ariaLabel="Install Rowdy Cup">
      {body}
      <button
        type="button"
        onClick={onClose}
        className="mt-5 w-full rounded-lg bg-muted py-2.5 px-4 text-sm font-semibold text-foreground transition-transform active:scale-95"
      >
        Done
      </button>
    </Modal>
  );
}
