import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

interface BulkTagBody extends Record<string, unknown> {
  jobIds?: unknown;
  tagIds?: unknown;
  mode?: unknown;
}

const MAX_JOBS = 200;

export const POST = withMutationAuth("ocr:control", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<BulkTagBody>(request);

  if (!Array.isArray(body.jobIds)) throw new ApiRouteError("jobIds must be an array", 400);
  if (!Array.isArray(body.tagIds)) throw new ApiRouteError("tagIds must be an array", 400);

  const jobIds = Array.from(
    new Set(body.jobIds.filter((v): v is string => typeof v === "string" && v.length > 0)),
  );
  const tagIds = Array.from(
    new Set(body.tagIds.filter((v): v is string => typeof v === "string" && v.length > 0)),
  );
  if (jobIds.length === 0) throw new ApiRouteError("jobIds must contain at least one id", 400);
  if (jobIds.length > MAX_JOBS) {
    throw new ApiRouteError(`jobIds may not exceed ${MAX_JOBS} entries`, 413);
  }

  let mode: "add" | "replace";
  if (body.mode === undefined || body.mode === "add") {
    mode = "add";
  } else if (body.mode === "replace") {
    mode = "replace";
  } else {
    throw new ApiRouteError("mode must be 'add' or 'replace'", 400);
  }

  const ownedJobs = await db.ocrJob.findMany({
    where: { id: { in: jobIds }, userId: auth.userId },
    select: { id: true },
  });
  if (ownedJobs.length !== jobIds.length) {
    throw new ApiRouteError("One or more jobIds not found", 404);
  }

  if (tagIds.length > 0) {
    const ownedTags = await db.tag.findMany({
      where: { id: { in: tagIds }, userId: auth.userId },
      select: { id: true },
    });
    if (ownedTags.length !== tagIds.length) {
      throw new ApiRouteError("One or more tagIds not found", 404);
    }
  }

  if (mode === "replace") {
    const dedupedRows = jobIds.flatMap((jobId) =>
      tagIds.map((tagId) => ({ jobId, tagId })),
    );
    await db.$transaction([
      db.jobTag.deleteMany({ where: { jobId: { in: jobIds } } }),
      ...(dedupedRows.length > 0
        ? [db.jobTag.createMany({ data: dedupedRows })]
        : []),
    ]);
  } else {
    if (tagIds.length === 0) {
      return NextResponse.json({ updated: 0, mode });
    }
    await db.$transaction(async (tx) => {
      const existing = await tx.jobTag.findMany({
        where: { jobId: { in: jobIds }, tagId: { in: tagIds } },
        select: { jobId: true, tagId: true },
      });
      const existingKeys = new Set(existing.map((row) => `${row.jobId}:${row.tagId}`));
      const newRows = jobIds
        .flatMap((jobId) => tagIds.map((tagId) => ({ jobId, tagId })))
        .filter((row) => !existingKeys.has(`${row.jobId}:${row.tagId}`));
      if (newRows.length > 0) {
        await tx.jobTag.createMany({ data: newRows });
      }
    });
  }

  return NextResponse.json({ updated: jobIds.length, mode });
});
