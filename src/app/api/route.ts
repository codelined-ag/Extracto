import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "ocr-webapp",
    docs: "/api/health",
  });
}