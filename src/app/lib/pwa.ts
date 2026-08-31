/** Registers the same-origin cache used for the public Alexandria shell. */
export function registerOfflineReadingWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  void navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(async () => {
      await navigator.serviceWorker.ready;
      navigator.serviceWorker.controller?.postMessage({
        type: "CACHE_PUBLIC_ASSETS",
        urls: performance.getEntriesByType("resource").map((entry) => entry.name),
      });
    })
    .catch(() => undefined);
}
