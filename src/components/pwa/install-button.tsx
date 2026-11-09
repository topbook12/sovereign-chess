"use client";

/**
 * Sovereign Chess — Install button (header).
 *
 * - Chrome/Edge/Android: fires the native install sheet.
 * - iOS Safari: opens the royal popup with Add-to-Home-Screen steps.
 * - Hidden once the app runs installed — never dead UI.
 */

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  detectIOS,
  promptInstall,
  usePwaStore,
} from "@/lib/pwa-store";
import { toast } from "sonner";

export function InstallButton() {
  const deferred = usePwaStore((s) => s.deferred);
  const installed = usePwaStore((s) => s.installed);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => setIos(detectIOS()));
    return () => cancelAnimationFrame(r);
  }, []);

  if (installed || (!deferred && !ios)) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            if (deferred) {
              void promptInstall().then((outcome) => {
                if (outcome === "dismissed") {
                  toast("Install dismissed — the crown will wait for you.", {
                    description:
                      "You can install Sovereign anytime from this button.",
                  });
                }
              });
            } else {
              usePwaStore.getState().setPromptOpen(true);
            }
          }}
          className="h-11 w-11 border-gold/40 bg-gold/10 text-gold-soft hover:border-gold hover:bg-gold/20 sm:h-9 sm:w-9"
          aria-label={
            deferred
              ? "Install Sovereign as an app"
              : "How to install Sovereign on this device"
          }
        >
          <Download className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {deferred
          ? "Install the app — play offline, right from your home screen"
          : "Install guide — add Sovereign to your home screen"}
      </TooltipContent>
    </Tooltip>
  );
}
