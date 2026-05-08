export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startJobRetentionSweep } = await import("@/lib/background/job-retention");
  startJobRetentionSweep();

  const { startWatchedFolderIngestion } = await import("@/lib/background/watched-folder");
  startWatchedFolderIngestion();

  const { startS3Watcher } = await import("@/lib/s3/watcher");
  startS3Watcher();

  const { startCloudWatcher } = await import("@/lib/integrations/watcher");
  startCloudWatcher();

  const { startWebhookRetrySweep, startWebhookRetentionSweep } = await import("@/lib/background/webhooks");
  startWebhookRetrySweep();
  startWebhookRetentionSweep();

  const { startOrphanJobSweep } = await import("@/lib/background/orphan-jobs");
  startOrphanJobSweep();

  const { runSecretMigrationOnce } = await import("@/lib/background/secret-migration");
  void runSecretMigrationOnce();

  const { setupOcrJobFts } = await import("@/lib/background/fts5-setup");
  void setupOcrJobFts();

  const { startLongpollWorkers } = await import("@/lib/integrations/longpoll");
  startLongpollWorkers();
}
