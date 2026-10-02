"use client";

import Link from "next/link";
import { CircleAlert, RotateCcw } from "lucide-react";

/**
 * Route-level error boundary. This app leans on optimistic updates and
 * server-side writes, so an uncaught render error must still leave the
 * traveller an exit — Next's default production error page has none.
 */
export default function TripError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="w-full max-w-md rounded-[16px] border border-border bg-surface p-6 text-center shadow-sm">
        <CircleAlert className="mx-auto size-8 text-rose-500" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">页面出了点问题</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
          刚才的操作可能没有保存成功。可以重试一次，或回到「我的旅行」继续。
        </p>
        {error.digest ? <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">错误编号 {error.digest}</p> : null}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RotateCcw className="size-3.5" />
            重试
          </button>
          <Link
            href="/trips"
            className="inline-flex h-9 items-center rounded-[10px] border border-border px-4 text-[13px] text-foreground transition-colors hover:bg-secondary"
          >
            我的旅行
          </Link>
        </div>
      </div>
    </main>
  );
}
