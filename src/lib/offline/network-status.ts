export function isClientOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  if (typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (typeof error === "object" && error !== null) {
    const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
    if (/Failed to fetch|NetworkError|network request failed|Load failed/i.test(message)) return true;
  }
  return false;
}

export type NetworkStatusListener = (online: boolean) => void;

export function subscribeNetworkStatus(listener: NetworkStatusListener): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onOnline = () => listener(true);
  const onOffline = () => listener(false);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
