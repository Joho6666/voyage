# Voyage Phase 2 — Real Intelligence & Persistence

目标：把 Voyage 从高保真前端原型升级为真正可运行的 AI 旅行规划 MVP。
核心闭环：输入需求 → 真实 LLM 生成结构化 Trip → 持久化 → 地图展示 → AI Action 修改 → 刷新后仍在。

## 当前架构分析

已具备（Phase 1 遗产，保留）：

- Next.js 15 App Router + React 19 + TS strict，`voyage/` 独立仓库
- Provider 分层：`services/map`、`services/ai`、`services/booking`、`services/trips`
- 重庆 Demo 数据（`data/demo/chongqing.ts`）、行程/路段重算（`services/routing.ts`）
- UI：Trip Workspace 三栏、Itinerary 拖拽、MockMap、AssistantSheet、Today 骨架
- lint / tsc / build 全部干净（Phase A 审计结论）

缺陷（本轮要修）：

| # | 缺陷 | 位置 |
|---|---|---|
| 1 | OpenAITravelAgent 只是继承 Mock | `services/ai/openai.ts` |
| 2 | 无 LLM 服务端调用，Key 无处安放 | 缺 `app/api/*` |
| 3 | TripRepository 只有 Memory，Supabase 是 throw stub | `services/trips/repository.ts` |
| 4 | Domain Model 缺 ownerId/currency/status/source/endTime/polyline/booking | `types/travel.ts` |
| 5 | 无 Zod 校验，LLM JSON 会被直接信任 | 全局 |
| 6 | AI 无结构化 Action，只有硬编码中文关键词 chat | `services/ai/mock.ts` |
| 7 | AMapProvider 只检测 Key，无 geocode/POI/route | `services/map/amap.ts` |
| 8 | `/trip/[id]` 硬编码 MockMap，无真实地图路径 | `app/trip/[id]/layout.tsx` |
| 9 | 无 undo/redo | — |
| 10 | 无测试、无 CI | — |

## 新增文件

```
src/schemas/trip.ts                    # 全域 Zod schema（Trip/Place/Item/Action…）
src/services/ai/actions/types.ts       # TravelAction 类型
src/services/ai/actions/schemas.ts     # Action Zod schema
src/services/ai/actions/executor.ts    # 纯函数执行 + route/budget 重算
src/services/ai/actions/planner.ts     # LLM → TravelAction[]（服务端）
src/services/ai/llm.ts                 # OpenAI-compatible fetch（服务端 only）
src/services/ai/openai.ts              # 真实现：createTrip/planActions → server route
src/services/trips/supabase.ts         # SupabaseTripRepository
src/services/map/amap-rest.ts          # AMap REST（服务端代理，Key 不出服务器）
src/services/map/amap-js.ts            # AMap JS SDK loader（客户端）
src/services/weather/types.ts          # WeatherProvider
src/services/weather/amap.ts           # AMap 天气实现 + fallback
src/store/history-store.ts             # undo/redo（最近 10 步）
src/app/api/agent/create/route.ts      # POST 创建 Trip（LLM）
src/app/api/agent/plan-actions/route.ts# POST 自然语言 → Action[]
src/app/api/amap/poi/route.ts          # POI 搜索代理
src/app/api/amap/route/route.ts        # 路径规划代理
src/app/api/weather/route.ts           # 天气代理
src/components/map/AMapCanvas.tsx      # 真地图渲染（动态加载，fallback MockMap）
supabase/migrations/0001_init.sql      # 建表 + RLS + index
tests/*.test.ts                        # schema/executor/routing/budget/repository/llm
.github/workflows/ci.yml               # lint/typecheck/test/build
```

## 修改文件

- `types/travel.ts`：补 ownerId、currency、status、createdAt/updatedAt、source/sourceId、endTime、note、reservationId、polyline、Booking（全部向后兼容，可选项）
- `services/trips/repository.ts`：工厂函数，Supabase 配置则用真库，否则 Memory
- `services/ai/mock.ts`：chat 改为走 planner（有 LLM）/ 规则（无 LLM）
- `app/trip/[id]/layout.tsx`：MockMap → MapCanvas（AMap 或 Mock）
- `app/trip/[id]/today/page.tsx`：快捷 AI 按钮 → 真 Action 执行
- `components/ai/AssistantSheet.tsx`：proposal 执行 → executor + undo
- `features/new-trip/NewTripExperience.tsx`：走 `/api/agent/create`
- `package.json`：+typecheck/test 脚本、+vitest/@supabase

## 数据流

```
UI (components)
  → store (zustand: ui/history) + TanStack Query
  → services (agent / repository / map / weather)
  → app/api/* (server-only，LLM & AMap Key)
  → LLM / AMap REST / Supabase
```

AI Flow（创建）：输入 → server route → candidate POI（AMap 有 Key 用真实 POI，无 Key 用 Demo 库）→ LLM Structured JSON（只允许引用 candidate placeId，坐标不生成）→ Zod 校验 → recompute → repository.save。

Action Flow：自然语言 → planner（LLM 输出 TravelAction[]）→ Zod 校验 → executor 纯函数 → route/budget 重算 → history 入栈（≤10）→ optimistic UI → repository.save。

Map Flow：有 NEXT_PUBLIC_AMAP_KEY → 动态加载 AMap JS；无 → MockMap。REST 一律走 `/api/amap/*` 代理（服务端 Key）。

DB Flow：Supabase migrations 建 trips/trip_days/places/itinerary_items/route_segments/budget_items/trip_tasks/bookings，全部带 owner_id + RLS。未配置 env → MemoryRepository，不 crash。

## Security

- LLM/AMap Server Key 只在服务端；禁止 NEXT_PUBLIC_LLM_*
- 出站 URL 白名单（LLM_BASE_URL 校验 + AMap 固定域名），拒绝 localhost/私有/保留 IP
- Supabase 查询全部走 query builder（参数化），RLS 按 owner_id 隔离

## Risks

1. AMap JS SDK 与 React 19 兼容 → 用动态加载 + 容器 ref，失败 fallback MockMap
2. LLM 输出不合法 JSON → zod parse 失败即报错保留用户输入，可重新生成
3. Supabase 未配置 → 全链路 fallback Memory，UI 不感知
4. Test 环境 Next 15 alias → vitest.config 用 vite-tsconfig-paths

## Execution order

B（schema+db）→ C（LLM+Action）→ D（AMap）→ E（UI 联动+Today）→ F（test+CI+README）
