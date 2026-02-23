import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes: home and health check. Static assets excluded via matcher below.
  if (pathname === "/" || pathname === "/api/health") {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: [
    // Match everything except static files and Next.js internals
    "/((?!_next/static|_next/image|icon.svg|logo.svg|favicon.ico).*)",
  ],
};
