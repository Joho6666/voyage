import "server-only";

import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { readRequestCookie } from "@/lib/cookie";

const cookieName = "voyage_guest_workspace";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A guest workspace only ever contains these subdirectories. */
const KNOWN_GUEST_ENTRIES = new Set(["trips", "planning-sessions", "proposals"]);

function guestTtlDays() {
  const raw = Number(process.env.VOYAGE_GUEST_TTL_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30;
}

function looksLikeGuestWorkspace(entries: Dirent[]) {
  return entries.every((entry) => entry.isDirectory() && KNOWN_GUEST_ENTRIES.has(entry.name));
}

/**
 * Directory mtime alone misses in-place file updates, so take the newest
 * timestamp across the whole subtree before deciding a guest is idle.
 */
async function lastActivityMs(dir: string): Promise<number> {
  let latest = (await stat(dir)).mtimeMs;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      let childStat;
      try {
        childStat = await stat(child);
      } catch {
        continue;
      }
      if (childStat.mtimeMs > latest) latest = childStat.mtimeMs;
      if (entry.isDirectory()) stack.push(child);
    }
  }
  return latest;
}

function resolveDataDir() {
  return path.resolve(process.env.VOYAGE_DATA_DIR ?? path.join(process.cwd(), ".voyage"));
}

/**
 * Guest-side maintenance (stale guests + expired share files) runs at most
 * once per debounce window per process, so a scripted burst of cookie-less
 * requests cannot amplify into continuous directory-tree stat walks.
 */
const MAINTENANCE_DEBOUNCE_MS = 10 * 60_000;
let lastMaintenanceAt = 0;

function runMaintenanceOnce(keepWorkspaceId: string) {
  const now = Date.now();
  if (now - lastMaintenanceAt < MAINTENANCE_DEBOUNCE_MS) return;
  lastMaintenanceAt = now;
  void sweepStaleGuests({ keepWorkspaceId })
    .catch((error) => logger.debug("guests.sweep_failed", { error }));
  void sweepExpiredShares()
    .catch((error) => logger.debug("shares.sweep_failed", { error }));
  void sweepExpiredProposals()
    .catch((error) => logger.debug("proposals.sweep_failed", { error }));
}

/**
 * Removes share files whose expiresAt has passed. Share files live at the
 * data-dir root (`shares/<token>.json`, global across guests) — the guest
 * sweep never sees them, so without this they accumulate forever.
 */
export async function sweepExpiredShares(options: { sharesDir?: string; now?: Date } = {}): Promise<number> {
  const dir = path.resolve(options.sharesDir ?? path.join(resolveDataDir(), "shares"));
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const now = (options.now ?? new Date()).getTime();
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/i.test(entry.name)) continue;
    const file = path.resolve(dir, entry.name);
    if (!file.startsWith(dir + path.sep)) continue;
    try {
      const share = JSON.parse(await readFile(file, "utf8")) as { expiresAt?: unknown };
      if (typeof share.expiresAt === "number" && share.expiresAt < now) {
        await rm(file, { force: true });
        removed += 1;
      }
    } catch (error) {
      logger.debug("shares.sweep_entry_failed", { file: entry.name, error });
    }
  }
  if (removed) logger.info("shares.swept_expired", { removed });
  return removed;
}

/**
 * Removes proposal files whose one-time token has expired without ever being
 * applied, plus leftover `.tmp` fragments from interrupted atomic writes.
 * Every guest embeds a full trip copy per proposal, so without this sweep an
 * active workspace's proposals/ directory grows without bound — the guest
 * TTL only reaps users idle for 30 days. Returns the number of expired
 * proposal records removed (`.tmp` fragments are cleaned silently).
 */
export async function sweepExpiredProposals(options: { guestsRoot?: string; now?: Date } = {}): Promise<number> {
  const rootBoundary = path.resolve(options.guestsRoot ?? path.join(resolveDataDir(), "guests"));
  let guests: Dirent[];
  try {
    guests = await readdir(rootBoundary, { withFileTypes: true });
  } catch {
    return 0;
  }
  const now = (options.now ?? new Date()).getTime();
  let removed = 0;
  for (const guest of guests) {
    if (!guest.isDirectory() || !uuid.test(guest.name)) continue;
    const proposalsDir = path.resolve(rootBoundary, guest.name, "proposals");
    let entries: Dirent[];
    try {
      entries = await readdir(proposalsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = path.resolve(proposalsDir, entry.name);
      if (!file.startsWith(proposalsDir + path.sep)) continue;
      if (entry.name.endsWith(".tmp")) {
        await rm(file, { force: true }).catch(() => undefined);
        continue;
      }
      if (!/^[A-Za-z0-9_-]+\.json$/.test(entry.name)) continue;
      try {
        const proposal = JSON.parse(await readFile(file, "utf8")) as { expiresAt?: unknown };
        if (typeof proposal.expiresAt === "string" && new Date(proposal.expiresAt).getTime() < now) {
          await rm(file, { force: true });
          removed += 1;
        }
      } catch (error) {
        logger.debug("proposals.sweep_entry_failed", { file: entry.name, error });
      }
    }
  }
  if (removed) logger.info("proposals.swept_expired", { removed });
  return removed;
}

/**
 * Removes guest workspaces idle past the TTL (default 30 days, disable with
 * VOYAGE_GUEST_TTL_DAYS=0). The sweep root comes from the resolved data dir
 * unless a caller (tests) injects one explicitly. Only UUID-shaped
 * directories whose contents are exactly the known guest subdirectories are
 * ever considered, the kept workspace is skipped, and every touched path is
 * verified to stay inside the root boundary.
 */
export async function sweepStaleGuests(
  options: { guestsRoot?: string; keepWorkspaceId?: string; now?: Date } = {},
): Promise<string[]> {
  const ttlDays = guestTtlDays();
  if (ttlDays === 0) return [];
  const rootBoundary = path.resolve(options.guestsRoot ?? path.join(resolveDataDir(), "guests"));
  const cutoff = (options.now ?? new Date()).getTime() - ttlDays * 86_400_000;
  let entries: Dirent[];
  try {
    entries = await readdir(rootBoundary, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !uuid.test(entry.name)) continue;
    if (entry.name === options.keepWorkspaceId) continue;
    const dir = path.resolve(rootBoundary, entry.name);
    if (!dir.startsWith(rootBoundary + path.sep)) continue;
    let children: Dirent[];
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (!looksLikeGuestWorkspace(children)) continue;
    try {
      if ((await lastActivityMs(dir)) > cutoff) continue;
      await rm(dir, { recursive: true, force: true });
      removed.push(entry.name);
      logger.info("guests.swept_stale_workspace", { workspaceId: entry.name, ttlDays });
    } catch (error) {
      logger.debug("guests.sweep_entry_failed", { workspaceId: entry.name, error });
    }
  }
  return removed;
}

export type TripImportAuthorization = "workspace" | "public-demo" | "denied";

export function authorizeTripImport(input: {
  tripId: string;
  workspaceTripExists: boolean;
  demoMode?: string;
  publicDemoTripIds: readonly string[];
}): TripImportAuthorization {
  if (input.workspaceTripExists) return "workspace";
  if (input.demoMode === "true" && input.publicDemoTripIds.includes(input.tripId)) return "public-demo";
  return "denied";
}

export function guestWorkspace(request: Request | NextRequest) {
  const existing = readRequestCookie(request, cookieName);
  const id = existing && uuid.test(existing) ? existing : randomUUID();
  const base = resolveDataDir();
  if (id !== existing) {
    // A brand-new guest is the natural moment to reap expired data; never
    // await it, the request must not pay for it, and the debounce keeps a
    // request storm from turning into a stat storm.
    runMaintenanceOnce(id);
  }
  return { id, fresh: id !== existing, root: path.join(base, "guests", id), base };
}

export function setGuestCookie(response: NextResponse, workspace: ReturnType<typeof guestWorkspace>) {
  if (workspace.fresh) response.cookies.set(cookieName, workspace.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}
