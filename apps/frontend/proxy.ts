import { withMiddlewareAuthRequired } from "@auth0/nextjs-auth0/edge";

export const proxy = withMiddlewareAuthRequired();

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
