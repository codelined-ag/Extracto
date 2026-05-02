export class VectorStoreError extends Error {
  constructor(public readonly store: string, message: string, public readonly status?: number) {
    super(`${store}: ${message}`);
    this.name = "VectorStoreError";
  }
}
