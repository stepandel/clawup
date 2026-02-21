import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only the home page and health check are publicly accessible
  // Everything else redirects to home
  if (pathname === "/" || pathname === "/api/health" || pathname.startsWith("/blog")) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: [
    // Match everything except static files and Next.js internals
    "/((?!_next/static|_next/image|icon.svg|favicon.ico).*)",
  ],
};
