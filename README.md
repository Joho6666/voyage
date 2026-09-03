# Voyage · Travel OS

AI-native 旅行操作系统。不是攻略生成器，也不是 OTA 首页。

用户用自然语言描述一次旅行，Voyage 生成**可操作的 Trip 项目**：每日行程、地图、路段、预算、任务。之后每一句「太累了 / 帮我省 300 / 把洪崖洞改到晚上」都会变成结构化 `TravelAction`，真正改数据，而不是再吐一篇 Markdown。

品牌名集中在 [`src/lib/brand.ts`](src/lib/brand.ts)。

---

## 核心闭环

打开首页 → 输入需求 → 服务端 LLM 生成结构化 Trip（坐标来自地图 Provider，不是模型编造）→ 写入 Repository（Supabase 或内存）→ 地图 + 行程双向联动 → AI Action 修改行程 / 路线 / 预算 → 刷新后数据仍在（Supabase 已配置时）。

无任何 API Key 时，整条路径走 Mock / Demo 数据，产品仍然可完整体验。

## 技术栈

- Next.js 15 App Router · React 19 · TypeScript strict
- Tailwind CSS v4 · Radix · Motion · dnd-kit
- Zustand（UI / undo）· TanStack Query
- Zod（Trip + TravelAction 校验）
- Vitest

## 架构

```
components
  → services (TravelAgent / Map / Weather / Booking / TripRepository)
    → app/api/*   (server-only：LLM、AMap REST、天气)
      → LLM / AMap / Supabase
```

Key 不出客户端。`LLM_API_KEY`、`AMAP_SERVER_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 只在服务端。

| Provider | 真实路径 | Fallback |
|---|---|---|
| TravelAgent | `OpenAITravelAgent` → `/api/agent/*` | 规则引擎 + 重庆 Demo |
| Map | AMap JS SDK + REST（geocode / POI / walking / transit） | `MockMap` 投影地图 |
| TripRepository | `SupabaseTripRepository` | `MemoryTripRepository` |
| Weather | 高德天气 REST | 行程内置天气 |
| Booking | Mock 外链 | — |

## 启动

```bash
cd voyage
npm install
cp .env.example .env.local   # 可选
npm run dev
```

打开 [http://localhost:3002](http://localhost:3002)

内置 Demo：重庆 3 天 2 夜 → `/trip/chongqing-2026`

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## 环境变量

| 变量 | 用途 |
|---|---|
| `LLM_BASE_URL` | OpenAI-compatible Chat Completions 根地址。必须是公网 http(s)，拒绝 localhost / 私网 |
| `LLM_API_KEY` | 服务端密钥 |
| `LLM_MODEL` | 模型名 |
| `NEXT_PUBLIC_AMAP_KEY` | 高德 JS SDK。有则加载真地图 |
| `NEXT_PUBLIC_AMAP_SECURITY_CODE` | 高德安全密钥 |
| `AMAP_SERVER_KEY` | 高德 REST（POI / 路线 / 天气） |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 匿名 Key |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅服务端，当前仓库不往客户端打包 |

未配置时对应 Provider 自动降级，不会白屏。

Schema 见 [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)。`trips.payload` 是完整 Trip 的 round-trip 源；规范化子表用于查询。

## AI Agent Actions

自然语言先变成 `TravelAction[]`（Zod 校验），再由纯函数 executor 改 Trip、重算路线和预算。最近 10 步可撤销。

`MOVE_ITEM` · `REMOVE_ITEM` · `ADD_ITEM` · `REPLACE_ITEM` · `OPTIMIZE_DAY` · `REDUCE_WALKING` · `REDUCE_BUDGET` · `CHANGE_TRANSPORT` · `RECOMMEND_FOOD` · `RECOMMEND_PLACES` · `CHANGE_TIME` · `CHANGE_DAY`

LLM 不允许编造坐标。候选地点来自 AMap POI 或 Demo 库，模型只能引用 `placeId`。

## 文档

- [`docs/TRAVEL_OS_ARCHITECTURE.md`](docs/TRAVEL_OS_ARCHITECTURE.md)
- [`docs/TRAVEL_OS_DESIGN_SYSTEM.md`](docs/TRAVEL_OS_DESIGN_SYSTEM.md)
- [`docs/MVP_PLAN.md`](docs/MVP_PLAN.md)
- [`docs/PHASE2_IMPLEMENTATION_PLAN.md`](docs/PHASE2_IMPLEMENTATION_PLAN.md)

## Roadmap

1. 真登录 + RLS 收紧到 `auth.uid()`
2. 路线 polyline 全部走高德方向 API，替换 haversine 启发式
3. Explore 二次排序接入真实营业时间
4. Playwright E2E：创建 → 拖拽 → AI 调整 → 刷新仍在
5. 天气驱动的「下雨方案」Action
