import { NextRequest, NextResponse } from "next/server";

import { withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const userId = auth.userId;

  const [
    jobsTotal,
    jobsCompleted,
    jobsFailed,
    jobsRunning,
    apiKeyCount,
    presetCount,
    webhookCount,
    templateCount,
    watcherCount,
    pushSubCount,
    extractedTextSize,
    recentJobs,
  ] = await Promise.all([
    db.ocrJob.count({ where: { userId } }),
    db.ocrJob.count({ where: { userId, status: "COMPLETED" } }),
    db.ocrJob.count({ where: { userId, status: "FAILED" } }),
    db.ocrJob.count({ where: { userId, status: { in: ["QUEUED", "PROCESSING"] } } }),
    db.apiKey.count({ where: { userId } }),
    db.outputPreset.count({ where: { userId } }),
    db.webhook.count({ where: { userId } }),
    db.ocrJobTemplate.count({ where: { userId } }),
    db.watchedS3Source.count({ where: { userId } }),
    db.pushSubscription.count({ where: { userId } }),
    db.ocrJob.aggregate({
      where: { userId, status: "COMPLETED" },
      _sum: { processingMs: true },
    }),
    db.ocrJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        fileName: true,
        status: true,
        model: true,
        createdAt: true,
        processingMs: true,
      },
    }),
  ]);

  const totalProcessingMs = extractedTextSize._sum.processingMs ?? 0;

  return NextResponse.json({
    jobs: {
      total: jobsTotal,
      completed: jobsCompleted,
      failed: jobsFailed,
      running: jobsRunning,
    },
    resources: {
      apiKeys: apiKeyCount,
      outputPresets: presetCount,
      webhooks: webhookCount,
      jobTemplates: templateCount,
      watchedS3Sources: watcherCount,
      pushSubscriptions: pushSubCount,
    },
    aggregate: {
      totalProcessingMs,
    },
    recentJobs,
  });
});
