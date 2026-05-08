const inflight = new Map<string, Promise<string>>();

export async function withTokenLock(
  userId: string,
  provider: string,
  task: () => Promise<string>,
): Promise<string> {
  const key = `${userId}::${provider}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = task().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
