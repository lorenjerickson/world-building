import { handleAuth } from "@auth0/nextjs-auth0";
import type { NextRequest } from "next/server";

const authHandler = handleAuth();

interface AuthRouteContext {
  params: Promise<{ auth0: string[] }>;
}

async function dispatchAuth(request: NextRequest, context: AuthRouteContext) {
  const params = await context.params;
  return authHandler(request, { params });
}

export { dispatchAuth as GET, dispatchAuth as POST };
