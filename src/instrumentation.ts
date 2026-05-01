export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startJobRetentionSweep } = await import("@/lib/job-retention");
  startJobRetentionSweep();

  const { startWatchedFolderIngestion } = await import("@/lib/watched-folder");
  startWatchedFolderIngestion();
}
