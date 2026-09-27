"use client";

import { AlertCircle, CheckCircle2, Cpu, LoaderCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanningLlmStatus } from "./types";

const STATUS_COPY: Record<PlanningLlmStatus["state"], { title: string; description: string }> = {
  ready: {
    title: "模型协作中",
    description: "服务端模型正在帮你整理偏好，路线仍会经过旅行规则校验。",
  },
  fallback: {
    title: "规则规划接管",
    description: "模型暂时没有参与，本次会使用确定性规则完成路线。",
  },
  unavailable: {
    title: "规则规划模式",
    description: "尚未启用模型服务，仍可继续规划；不会在浏览器暴露任何凭据。",
  },
  error: {
    title: "模型暂时不可用",
    description: "本轮已安全降级，不影响继续补充旅行偏好。",
  },
  unknown: {
    title: "等待规划状态",
    description: "会话建立后会显示模型或规则规划的实际状态。",
  },
};

function StatusIcon({ state }: { state: PlanningLlmStatus["state"] }) {
  if (state === "ready") return <CheckCircle2 className="size-4" />;
  if (state === "fallback" || state === "unavailable") return <ShieldCheck className="size-4" />;
  if (state === "error") return <AlertCircle className="size-4" />;
  return <LoaderCircle className="size-4 animate-spin" />;
}

export function PlanningStatusCard({ status, compact = false }: { status: PlanningLlmStatus; compact?: boolean }) {
  const copy = STATUS_COPY[status.state];
  const tone = status.state === "ready"
    ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-800 dark:text-emerald-200"
    : status.state === "fallback" || status.state === "unavailable"
      ? "border-amber-500/25 bg-amber-500/[0.07] text-amber-900 dark:text-amber-100"
      : status.state === "error"
        ? "border-rose-500/25 bg-rose-500/[0.06] text-rose-800 dark:text-rose-200"
        : "border-border bg-muted/35 text-foreground";

  return (
    <section className={cn("rounded-[14px] border p-3", tone)} aria-live="polite" aria-label="规划服务状态">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-background/70">
          {status.state === "unknown" ? <Cpu className="size-4" /> : <StatusIcon state={status.state} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-xs font-semibold">{status.label || copy.title}</h3>
            {status.provider || status.model ? (
              <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-current/70">
                {[status.provider, status.model].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </div>
          {!compact ? <p className="mt-1 text-[11px] leading-4 text-current/75">{copy.description}</p> : null}
          {status.reason ? <p className="mt-1 text-[11px] leading-4 text-current/80">{status.reason}</p> : null}
        </div>
      </div>
    </section>
  );
}
