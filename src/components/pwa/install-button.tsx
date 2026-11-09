"use client";

/**
 * Sovereign Chess — Install button.
 *
 * Appears in the header once the browser offers native installation
 * (Chrome / Edge / Android beforeinstallprompt). Invisible when the app
 * already runs installed, so it never renders dead UI.
 */

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePwaStore, promptInstall } from "@/lib/pwa-store";
import { toast } from "sonner";

export function InstallButton() {
  const deferred = usePwaStore((s) => s.deferred);
  const installed = usePwaStore((s) => s.installed);

  if (installed || !deferred) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            void promptInstall().then((outcome) => {
              if (outcome === "dismissed") {
                toast("Install dismissed — the crown will wait for you.", {
                  description:
                    "You can install Sovereign anytime from this button.",
                });
              }
            });
          }}
          className="h-9 w-9 border-gold/40 bg-gold/10 text-gold-soft hover:border-gold hover:bg-gold/20"
          aria-label="Install Sovereign as an app"
        >
          <Download className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Install the app — play offline, right from your home screen
      </TooltipContent>
    </Tooltip>
  );
}
