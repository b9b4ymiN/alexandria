// The sandboxed frame that renders an uploaded document.
//
// Written by node G1.10. This component is a security boundary, not a
// layout detail.
//
// WHY THE SANDBOX NEVER GAINS allow-same-origin
// Uploaded HTML may contain arbitrary JavaScript. Without
// `allow-same-origin` the framed document runs in an OPAQUE origin: it can
// execute scripts and load external fonts, images and CDN scripts, but it
// cannot read cookies, localStorage or sessionStorage for anything —
// including its own origin — and it cannot reach the Admin session, which
// lives in sessionStorage on the app origin. Adding `allow-same-origin`
// would hand every uploaded document the ability to read that session.
// It is forbidden by AGENT.md §8 and SPEC.md §16 and must never be added
// to fix a rendering problem; escalate for security review instead.
//
// WHY THE DOCUMENT SCROLLS INSIDE THE FRAME
// Sizing the frame to its content would require a script inside the
// document reporting its height back, which means injecting code into
// bytes we promised never to modify (AGENT.md §7). Internal scrolling is
// the only approach compatible with that promise.

export interface DocumentFrameProps {
  /** Absolute URL on the content origin, supplied by the API. */
  contentUrl: string;
  title: string;
}

export function DocumentFrame({ contentUrl, title }: DocumentFrameProps) {
  return (
    <iframe
      src={contentUrl}
      title={title}
      sandbox="allow-scripts allow-popups allow-downloads"
      referrerPolicy="strict-origin-when-cross-origin"
      className="h-full w-full border-0 bg-white"
    />
  );
}
