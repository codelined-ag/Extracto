import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

import { createS3EndpointLookup } from "@/lib/ocr/endpoint-policy";

export async function createS3EndpointRequestHandler(endpoint: string) {
  const { NodeHttpHandler } = await import("@smithy/node-http-handler");
  const lookup = createS3EndpointLookup(endpoint);
  return new NodeHttpHandler({
    httpAgent: new HttpAgent({ keepAlive: true, lookup }),
    httpsAgent: new HttpsAgent({ keepAlive: true, lookup }),
  });
}
