import type { NextRequest } from "next/server";

/**
 * Reads a cookie from either a NextRequest (typed cookies API) or a plain
 * Request (cookie header parsing). Used to live verbatim-duplicated in
 * api-guards.ts and workspace.ts.
 */
export function readRequestCookie(request: Request | NextRequest, name: string): string | undefined {
  if ("cookies" in request && request.cookies) return request.cookies.get(name)?.value;
  const header = request.headers.get("cookie") ?? "";
  return header
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}
