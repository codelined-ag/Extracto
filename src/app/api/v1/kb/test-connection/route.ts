import { NextRequest } from "next/server";

import { withMutationAuth } from "@/lib/auth/request";
import { handleKbTestConnection } from "@/lib/kb/stores/test-connection-handler";

export const POST = withMutationAuth("kb:write", async (request: NextRequest, { auth }) =>
  handleKbTestConnection(request, auth.userId),
);
