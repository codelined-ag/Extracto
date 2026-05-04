/**
 * Lazy getter so the env var is read at request time, not at module
 * import. Important for tests that mutate `process.env` and for the
 * docker-entrypoint flow that exports vars after Node has loaded.
 */
export function isKbExportEnabled(): boolean {
  const raw = process.env.KB_EXPORT_ENABLED?.toLowerCase().trim();
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw === "true";
}
