import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip proxy for static files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot)$/i)
  ) {
    return NextResponse.next();
  }

  // Always allow the login page to render, even if we *think*
  // the user is authenticated based on cookies alone.
  // This avoids redirect loops when Supabase cookies are stale
  // (e.g. "refresh_token_already_used" / invalid session).
  if (pathname === "/login") {
    return NextResponse.next();
  }

  // Important: keep this check lightweight.
  // We only gate on presence of Supabase cookies; we do NOT call Supabase here.
  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasAuthCookie = cookieHeader.includes("sb-") || cookieHeader.includes("supabase");

  if (!hasAuthCookie) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-spotibase-pathname", pathname);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  // Only run auth gating on protected app routes (avoid extra work on every request).
  // Static assets are already excluded above, but narrowing the matcher reduces proxy invocations.
  matcher: [
    "/",
    "/artists/:path*",
    "/catalog/:path*",
    "/tracks/:path*",
    "/playlists/:path*",
    "/playlist-watch/:path*",
    "/network",
    "/network/:path*",
    "/docs",
    "/docs/:path*",
    "/settings",
    "/settings/:path*",
    "/collectors/:path*",
    "/health/:path*",
    "/exports/:path*",
    "/api/search",
    "/api/search-stats",
    "/api/breadcrumb/:path*",
    "/api/spotify-track",
    "/api/spotify-track-batch",
    "/api/playlist-watch/:path*",
    "/api/health-summary",
    "/api/sai/models",
  ],
};

