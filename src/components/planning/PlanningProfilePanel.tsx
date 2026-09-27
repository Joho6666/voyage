"use client";

import { ArrowRight, CalendarDays, CircleDollarSign, MapPin, SlidersHorizontal, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PlanningStatusCard } from "./PlanningStatusCard";
import type { PlanningLlmStatus, PlanningProfileDraft } from "./types";

const VIBES = ["美食", "夜景", "自然", "摄影", "城市漫游", "轻松", "亲子", "小众"];
const PACES = ["轻松留白", "刚好充实", "特种兵一点"];
const WALKING_OPTIONS = ["少走路", "适中", "可以多走一点"];
const TRANSPORT_OPTIONS = ["公共交通优先", "混合安排", "打车更方便"];
const CITY_SUGGESTIONS = ["桂林", "重庆", "成都", "上海", "广州", "北京", "厦门", "西安", "大理", "丽江"];

export interface PlanningProfilePanelProps {
  profile: PlanningProfileDraft;
  onChange: (changes: Partial<PlanningProfileDraft>) => void;
  onGenerate?: () => void;
  generating?: boolean;
  disabled?: boolean;
  llmStatus?: PlanningLlmStatus;
  showStatus?: boolean;
  missingFields?: string[];
  direct?: boolean;
}

function FieldLabel({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Icon className="size-3.5" />{children}</span>;
}

export function PlanningProfilePanel({
  profile,
  onChange,
  onGenerate,
  generating = false,
  disabled = false,
  llmStatus,
  showStatus = true,
  missingFields = [],
  direct = false,
}: PlanningProfilePanelProps) {
  return (
    <section className="rounded-[20px] border border-border bg-surface p-4 shadow-[0_12px_35px_rgba(28,25,23,0.045)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-secondary text-secondary-foreground"><SlidersHorizontal className="size-4" /></span>
            <div>
              <h2 className="text-sm font-semibold">路线画像</h2>
              <p className="text-[11px] text-muted-foreground">边聊边补全，生成前随时可以改</p>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">可编辑</span>
      </div>

      {showStatus && llmStatus ? <div className="mt-4"><PlanningStatusCard status={llmStatus} compact /></div> : null}
      {missingFields.length ? <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-800 dark:text-amber-100"><span className="font-medium">还可以补充：</span>{missingFields.slice(0, 4).join("、")}</div> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          <FieldLabel icon={MapPin}>出发地</FieldLabel>
          <Input list="voyage-planning-cities" value={profile.origin} onChange={(event) => onChange({ origin: event.target.value })} placeholder="例如：桂林" disabled={disabled} />
        </label>
        <label>
          <FieldLabel icon={MapPin}>目的地</FieldLabel>
          <Input list="voyage-planning-cities" value={profile.destination} onChange={(event) => onChange({ destination: event.target.value })} placeholder="还没想好也可以先聊" disabled={disabled} />
        </label>
        <label>
          <FieldLabel icon={CalendarDays}>出发日期</FieldLabel>
          <Input type="date" value={profile.startDate} onChange={(event) => onChange({ startDate: event.target.value })} disabled={disabled} />
        </label>
        <label>
          <FieldLabel icon={CalendarDays}>返程日期</FieldLabel>
          <Input type="date" value={profile.endDate} onChange={(event) => onChange({ endDate: event.target.value })} disabled={disabled} />
        </label>
        <label>
          <FieldLabel icon={UsersRound}>同行人数</FieldLabel>
          <Input type="number" min={1} max={20} value={profile.travelers} onChange={(event) => onChange({ travelers: event.target.value })} placeholder="2" disabled={disabled} />
        </label>
        <label>
          <FieldLabel icon={CircleDollarSign}>总预算（元）</FieldLabel>
          <Input type="number" min={0} value={profile.budget} onChange={(event) => onChange({ budget: event.target.value })} placeholder="2500" disabled={disabled} />
        </label>
      </div>
      <datalist id="voyage-planning-cities">{CITY_SUGGESTIONS.map((city) => <option key={city} value={city} />)}</datalist>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-muted-foreground">想要的气氛</span><span className="text-[10px] text-muted-foreground">可多选</span></div>
        <div className="flex flex-wrap gap-1.5">
          {VIBES.map((vibe) => {
            const active = profile.vibes.includes(vibe);
            return (
              <button
                key={vibe}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ vibes: active ? profile.vibes.filter((item) => item !== vibe) : [...profile.vibes, vibe] })}
                className={cn(
                  "rounded-full border px-2.5 py-1.5 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50",
                  active ? "border-primary/30 bg-accent text-accent-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary",
                )}
                aria-pressed={active}
              >
                {vibe}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">节奏</p>
        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted/50 p-1">
          {PACES.map((pace) => (
            <button
              key={pace}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ pace })}
              className={cn("rounded-lg px-2 py-2 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50", profile.pace === pace ? "bg-surface font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
              aria-pressed={profile.pace === pace}
            >
              {pace}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">步行容忍度</p>
          <div className="flex flex-wrap gap-1.5">
            {WALKING_OPTIONS.map((option) => (
              <button key={option} type="button" disabled={disabled} onClick={() => onChange({ walkingTolerance: option })} className={cn("rounded-full border px-2.5 py-1.5 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50", profile.walkingTolerance === option ? "border-primary/30 bg-accent text-accent-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary")} aria-pressed={profile.walkingTolerance === option}>{option}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">交通偏好</p>
          <select value={profile.transportPreference} onChange={(event) => onChange({ transportPreference: event.target.value })} disabled={disabled} className="h-9 w-full rounded-[10px] border border-input bg-surface px-2.5 text-[11px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">还没确认</option>
            {TRANSPORT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">一定想去</span>
          <Input value={profile.mustVisit} onChange={(event) => onChange({ mustVisit: event.target.value })} placeholder="例如：夫子庙、夜游" disabled={disabled} />
        </label>
        <label>
          <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">想避开</span>
          <Input value={profile.avoid} onChange={(event) => onChange({ avoid: event.target.value })} placeholder="例如：过度赶路、排队" disabled={disabled} />
        </label>
      </div>

      <div className="mt-4 space-y-2 rounded-[14px] border border-border/80 bg-background/55 p-3">
        <p className="text-[11px] font-medium">可选增强</p>
        <label className="flex cursor-pointer items-start gap-2.5 text-[11px] text-muted-foreground">
          <input type="checkbox" className="mt-0.5 size-3.5 accent-[var(--primary)]" checked={profile.includeOffers} onChange={(event) => onChange({ includeOffers: event.target.checked })} disabled={disabled} />
          <span><strong className="font-medium text-foreground">参考实时优惠</strong><br />酒店、交通、门票和美食的可用结果会单独标明来源与核实状态。</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-[11px] text-muted-foreground">
          <input type="checkbox" className="mt-0.5 size-3.5 accent-[var(--primary)]" checked={profile.includeSocialEvidence} onChange={(event) => onChange({ includeSocialEvidence: event.target.checked })} disabled={disabled} />
          <span><strong className="font-medium text-foreground">参考社区攻略</strong><br />可查询小红书、抖音等公开攻略；内容只作参考，不会冒充实时事实。</span>
        </label>
      </div>

      {onGenerate ? (
        <div className="mt-4 border-t border-border/80 pt-4">
          <Button className="w-full" size="lg" onClick={onGenerate} disabled={disabled || generating || !profile.destination.trim()}>
            {generating ? "正在生成路线…" : direct ? "直接生成路线" : "生成路线图"}
            {!generating ? <ArrowRight className="ml-1" /> : null}
          </Button>
          <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">
            {direct ? "会把上面的信息作为初始规划意图提交" : "确认后才会创建行程，生成结果可继续调整"}
          </p>
        </div>
      ) : null}
    </section>
  );
}
