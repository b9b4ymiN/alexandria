// Share control for the Reader.
//
// Written by node G1.10. Uses the Web Share API where the browser offers it
// and falls back to copying the URL, with a visible confirmation either
// way. Nothing here is hover-only: the whole control is a button, which
// matters because the Reader is used mostly on phones (AGENT.md §24).
import { useState } from "react";

export interface ShareButtonProps {
  title: string;
}

type ShareState = "idle" | "copied" | "failed";

export function ShareButton({ title }: ShareButtonProps) {
  const [state, setState] = useState<ShareState>("idle");

  async function share() {
    const url = window.location.href;
    const navigatorWithShare = navigator as Navigator & {
      share?: (data: { title: string; url: string }) => Promise<void>;
    };

    if (typeof navigatorWithShare.share === "function") {
      try {
        await navigatorWithShare.share({ title, url });
        return;
      } catch {
        // The person dismissed the sheet, or the browser refused. Fall
        // through to copying rather than reporting a failure they caused.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  const message = state === "copied" ? "Link copied." : state === "failed" ? "Copy failed." : "";

  return (
    <>
      <button
        type="button"
        onClick={() => void share()}
        className="shrink-0 border border-[#b9c5dc] px-3 py-1.5 text-sm font-bold text-[#f7f5ef] transition hover:bg-white hover:text-[#071e4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]"
      >
        {state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : "Share"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </>
  );
}
