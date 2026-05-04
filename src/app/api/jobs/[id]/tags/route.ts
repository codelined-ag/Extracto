import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

interface JobTagsBody extends Record<string, unknown> {
  tagIds?: unknown;
}

export const PUT = withMutationAuth<{ id: string }>(
  "ocr:control",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Job id is required", 400);
    const body = await parseJsonBody<JobTagsBody>(request);
    if (!Array.isArray(body.tagIds)) throw new ApiRouteError("tagIds must be an array", 400);

    const tagIds = Array.from(
      new Set(
        body.tagIds.filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );

    const job = await db.ocrJob.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true },
    });
    if (!job) throw new ApiRouteError("Job not found", 404);

    if (tagIds.length > 0) {
      const owned = await db.tag.findMany({
        where: { id: { in: tagIds }, userId: auth.userId },
        select: { id: true },
      });
      if (owned.length !== tagIds.length) {
        throw new ApiRouteError("One or more tagIds not found", 404);
      }
    }

    await db.$transaction([
      db.jobTag.deleteMany({ where: { jobId: id } }),
      ...(tagIds.length > 0
        ? [db.jobTag.createMany({ data: tagIds.map((tagId) => ({ jobId: id, tagId })) })]
        : []),
    ]);

    const tags = await db.tag.findMany({
      where: { jobTags: { some: { jobId: id } }, userId: auth.userId },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ tags });
  },
);
