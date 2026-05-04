import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 300;

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Extracto API reference</title>
    <link rel="icon" href="/extracto-favicon.svg" />
  </head>
  <body>
    <div id="app"></div>
    <script
      id="api-reference"
      data-url="/api/v1/openapi.yaml"
      data-configuration='{"theme":"default","hideClientButton":false,"defaultHttpClient":{"targetKey":"shell","clientKey":"curl"}}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

export function GET() {
  return new NextResponse(HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://cdn.jsdelivr.net;",
    },
  });
}
