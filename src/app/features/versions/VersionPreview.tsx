// Signed, sandboxed preview of one historical version.
//
// Written by node G3.5.
//
// WHY A FRESH URL EVERY TIME
// The signed preview URL expires 5 minutes after it is minted, with no
// grace period (src/shared/signing.ts DEFAULT_PREVIEW_TTL_SECONDS,
// src/api/routes/admin/versions.ts GET .../preview-url). Storing or
// reusing one across renders or across opens risks handing the iframe a
// dead link, so this component requests a brand-new URL every time it
// mounts (i.e. every time a preview is opened) and again shortly before
// the current one expires if the preview is still open (node G3.5 Edge
// Case: "Preview link expiring while open -> re-request rather than
// showing a broken frame").
//
// SANDBOX CONTRACT
// This iframe carries the EXACT SAME sandbox and referrerPolicy attributes
// as the public Reader's DocumentFrame
// (src/app/components/DocumentFrame.tsx) — no `allow-same-origin`, ever
// (AGENT.md §8). If a preview could not render inside this sandbox, that
// would be a Stop Condition to escalate, never a reason to loosen it.
//
// Calls `adminRequest` directly rather than through a wrapper in
// api-client.ts: that file is also imported by public routes, and this
// component (reached only from the lazy Admin route,
// src/app/routes/admin/document-edit.tsx) is the one place this
// bearer-authenticated call belongs — see api-client.ts's file-level
// comment for why its exports for this endpoint are types only.
import { useEffect, useState } from "react";
import { adminRequest } from "../../lib/admin-session";
import type { VersionPreviewUrl } from "../../lib/api-client";

// Slack subtracted from the actual expiry so the scheduled refresh always
// lands before the link goes dead rather than racing it.
const REFRESH_SLACK_MS = 5000;

export interface VersionPreviewProps {
  slug: string;
  versionNo: number;
  onClose: () => void;
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

export function VersionPreview({ slug, versionNo, onClose }: VersionPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    function requestFreshUrl() {
      setState({ status: "loading" });
      adminRequest<VersionPreviewUrl>(
        `/api/admin/documents/${encodeURIComponent(slug)}/versions/${versionNo}/preview-url`,
      )
        .then((data) => {
          if (cancelled) return;
          setState({ status: "ready", url: data.url });
          const msUntilExpiry = new Date(data.expiresAt).getTime() - Date.now() - REFRESH_SLACK_MS;
          refreshTimer = setTimeout(requestFreshUrl, Math.max(msUntilExpiry, 0));
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "The preview link could not be issued.",
          });
        });
    }

    requestFreshUrl();

    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    };
    // Re-running on a versionNo change deliberately requests a fresh URL
    // rather than reusing whatever the previous version had in flight.
  }, [slug, versionNo]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of version ${versionNo}`}
      className="fixed inset-0 z-50 flex flex-col bg-[#071e4a]/85 p-3 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <p className="text-sm font-black text-[#f7f5ef]">Previewing version {versionNo}</p>
        <button
          type="button"
          onClick={onClose}
          className="border border-[#f7f5ef] px-3 py-1.5 text-xs font-bold text-[#f7f5ef] hover:bg-[#f7f5ef]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f7f5ef]"
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 bg-white">
        {state.status === "loading" && <p className="p-4 text-sm text-[#526889]">Requesting a preview link…</p>}
        {state.status === "error" && (
          <p role="alert" className="p-4 text-sm text-red-800">
            {state.message}
          </p>
        )}
        {state.status === "ready" && (
          <iframe
            src={state.url}
            title={`Version ${versionNo} preview`}
            sandbox="allow-scripts allow-popups allow-downloads"
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}

export default VersionPreview;
