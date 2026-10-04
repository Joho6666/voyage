# Voyage — Current Architecture（Phase 6 审计基线）

> 审计日期：2026-10-03 · main @ 9e915b4（含 Phase 4.1 brain + open-source-readiness 合并）
> Phase 6 更新：见 §2b（新增域与命令）、§5b（新 domain models）。分支收敛后远端仅剩 main。
> 本文档基于代码实况，不是 README 愿景。后续架构变更请同步更新此文件。

## 1. 分层架构图（实际调用关系）

```
Web (Next.js App Router, port 3002)
  ├─ /new-trip          对话式规划（features/new-trip + planning session API）
  ├─ /trip/[id]         today / explore / offers / transport 四子页
  └─ /api/*
      ├─ agent/tools        ← Agent 工具循环（LLM tool calling，15 工具白名单）
      ├─ voyage/command     ← Web 命令入口（1:1 转发 runtime）
      ├─ voyage/planning/*  ← 规划会话（profile 采集 / generate）
      ├─ amap/{poi,route}   ← 浏览器侧地图 POI 代理
      └─ social/*           ← 攻略链接抽取导入
Agent (OpenAITravelAgent, src/services/ai/openai.ts) → /api/agent/tools
MCP (packages/voyage-mcp/server.ts, stdio)          → VoyageSkillRuntime
Skill CLI (skills/voyage/scripts/voyage.mjs → src/skill/cli.ts) → VoyageSkillRuntime
        ↓ 全部入口收敛
VoyageSkillRuntime（src/skill/runtime.ts，唯一业务编排层，execute() 26 命令）
        ↓
Domain Services
  ├─ planning/    conversation-planner / outline-planner / profile / guide-extract / rule-planner
  ├─ ai/actions/  planner(LLM，暂未接入 proposeChange 主路径) / rule-planner / executor(24 action) / diff
  ├─ brain/       route-matrix(部分路线矩阵+TTL缓存) / constraints(硬软约束+一次修复)   [Phase 4.1, VOYAGE_BRAIN=1]
  ├─ transport/   options(多模式候选) / scoring(7维加权评分)
  ├─ knowledge/   hybrid-retriever(RAG: 关键词+pgvector) / context-builder
  ├─ social/      router(TikHub) / signal-extractor / context-builder / source-link
  ├─ weather/     merge / context
  ├─ booking/     fliggy-top / fliggy-offers ；meituan/runner（offers 聚合）
  ├─ trip-planner/create-trip.ts（legacy web 兼容 shim → runtime）
  └─ itinerary-optimizer/（cluster/schedule/time-windows/validate）＋ today/context  [open-source-readiness 合并]
        ↓
Providers / Repositories
  ├─ skill/providers.ts     AmapTravelProvider（POI/天气/路线）· FixtureTravelProvider · providerFromEnvironment
  ├─ skill/repository.ts    JsonSkillRepository（JSON 文件主存储；proposal/proposalToken/TTL/revision）
  ├─ Supabase               trips(payload jsonb) + knowledge_documents/chunks(pgvector) + social_observations/signals
  └─ src/services/map/      amap-rest（REST 细节，QPS 批控）
```

## 2. Runtime 命令清单（execute() 全表，26 个）

查询类：`get-trip` `search-places` `get-place` `plan-route` `get-route-options` `optimize-transport` `get-weather` `retrieve-travel-knowledge` `search-social` `get-social-trending` `get-social-evidence` `search-flights` `search-travel-offers` `get-today-context`
生成/修改类：`create-trip` `propose-change` `replan-trip` `apply-change` `update-trip` `restore-trip` `refresh-travel-offers`
行程直接编辑（UI 用，revision-locked）：`reorder-day` `add-place-item` `add-place` `import-route` `set-item-status` `set-task-status`

### 2b. Phase 6 新增（总计 46 命令）

- Reservation 域（6.1）：`add-reservation` `update-reservation` `remove-reservation` `get-reservations` `import-reservations`
- 约束/状态（6.2/6.4）：`get-constraints` `get-trip-state`
- 事件（6.3/6.8）：`record-travel-event` `get-active-events` `simulate-travel-event`（DEMO）
- 影响与重规划（6.5/6.6）：`analyze-event-impact` `propose-event-replan`
- 旅行者记忆（6.9）：`get-traveler-memory` `update-traveler-memory` `delete-traveler-memory` `disable-traveler-memory`
- open-source-readiness 并入：`remove-day` `remove-item` `optimize-itinerary`

新域服务：`src/services/brain/route-matrix.ts`（部分路线矩阵）、`src/services/brain/constraints.ts`（局部约束门 + trip 级约束引擎 + candidate-move 门）、`src/services/trip-state/engine.ts`（纯函数状态引擎）、`src/services/impact-engine.ts`（规则矩阵影响分析）、`src/services/replan/event-replan.ts`（Impact→TravelAction 映射）、`src/services/memory/preferences.ts`（显式优先偏好记忆）、`src/skill/event-providers.ts`（Weather/Flight/Mock 事件 Provider 接口）。

安全链：`propose-change`/`replan-trip`/`propose-event-replan` → saveProposal（proposalToken，10 分钟 TTL，一次性）→ `apply-change` 必须 `confirmed:true + proposalToken + expectedTripRevision` → revision 自增。LLM 永远不能 apply（agent 路由硬拦截返回 `CONFIRMATION_REQUIRED`；MCP `voyage_apply_change` 标 destructive）。

## 3. Agent 工具（/api/agent/tools，15 个）

get_trip · search_places · get_place · plan_route · get_route_options · optimize_transport · replan_trip · get_weather · retrieve_travel_knowledge · search_social_travel · find_trending_places · get_social_evidence · search_travel_offers · propose_change · apply_change（白名单内但硬拦截）

已知问题（Phase 6 6.6 处理）：replan_trip / propose_change / optimize_transport 边界模糊；无 get_trip_state 类高层工具；demo 模式关键词短路 regex（route.ts:296-313）是规则旁路。

## 4. MCP 工具（packages/voyage-mcp，14 个）

voyage_create_trip / get_trip / search_places / plan_route / get_route_options / optimize_transport / get_weather / retrieve_knowledge / search_social / search_offers / propose_change（WRITE，附 Diff 文本渲染）/ apply_change（DESTRUCTIVE）/ optimize_itinerary / today_context
MCP 是 runtime 的纯适配层（无业务逻辑）；skill CLI 文档（runtime-api.md）覆盖 20 命令，未列 6 个 UI 端命令（add-place/add-place-item/import-route/set-item-status/set-task-status/restore-trip）。

## 5. 核心 Domain Models（src/types/travel.ts + src/schemas/trip.ts）

- **Trip**：days/items/segments/places/budgetItems/tasks/offers/socialEvidence/socialSignals + **reservations**（6.1，payload jsonb）+ **travelEvents**（6.3，有界日志 200 条）+ planningMetadata（source/llm/planningProfile/brain）。存储为 Supabase payload jsonb + JsonSkillRepository 本地 JSON（schema 同一份 zod tripSchema）。
- **Reservation**（src/schemas/reservation.ts）：type（flight/train/hotel/restaurant/attraction/activity/car/transfer/other）、status（tentative/confirmed/cancelled/completed）、flexibility（fixed/semiFlexible/flexible）、startAt/endAt、confirmationCode、price、provenance（source:user|import|provider）。confirmed → HARD 约束。
- **TravelEvent**（src/schemas/travel-event.ts）：17 种 type、severity、effectiveFrom/Until、source（provider/user/system/simulation）、provenance（confidence/estimated）、payload、relatedEntities、acknowledgedAt。Provider 响应绝不直接进 Runtime——一律先 normalize。
- **TripState**（src/schemas/trip-state.ts）：phase/late/remaining/risk/constraints 等 20+ 字段，由 getTripState 纯函数计算，Asia/Shanghai 时区，stale 标记离线快照。
- **Place**：AMap POI + openingHours/openingStatus/stayMinutes/estimatedCost/vertical（爬坡）。
- **ItineraryItem**：`reservationId` 链接字段已启用；status: planned/current/done/skipped（done 即锁定）。
- **RouteSegment**：mode/distance/duration/polyline/estimated/provider/provenance。
- **provenance 体系**：DataProvenance + ProviderLevel 10 级 + confidence。原则：REAL 数据永远优先于 LLM 推断；LLM 禁止发明地点/坐标/价格/库存/天气。

## 6. Planner / Optimizer 架构

**生成**（createTrip，runtime.ts）：collectCandidates（AMap 6 类搜索，QPS 批控+重试）→ filterPlanningCandidates（确定性约束过滤）→ 天气+社交（socialOptIn）→ planOutline（LLM 严格 JSON + 候选白名单校验 + 天数纠错重试；rules fallback）→ [VOYAGE_BRAIN=1] 路线矩阵喂给 LLM + 排程后硬约束校验+一次修复+元数据落库 → estimateBudgetItems → enrichRoutes（QPS worker pool，并发 3）→ 美团报价并行 → 落库。
**修改**（proposeChange）：交通关键词门 → replanTrip（逐段多模式评分→CHANGE_ROUTE_MODE）；否则 planActionsWithRules 关键词 if-else（LLM 版 planActions 存在但未接入——Phase 6 后续接入）→ executeActions（24 种确定性 action）→ restoreLockedItems → 提案。
**评分**：transport/scoring.ts 7 维（time/cost/walking/transfers/weather/fatigue/risk）上下文自适应权重 + reasons。
**Optimizer**（itinerary-optimizer/，本次合并引入）：cluster/schedule/time-windows/validate，经 optimize-itinerary 命令与 MCP 工具暴露。

## 7. Today Mode

- `get-today-context` runtime 命令（today/context.ts）+ today 页建议条（features/today/suggestions.ts，7 条确定性规则：天气/空天/单点/超预算/重步行/无报价/行前任务）。
- Agent 对话面板走 /api/agent/tools（12 轮上下文，[dayId:xxx] 聚焦前缀）。
- Phase 6 目标：升级为 Execution Console（TripState 驱动）。

## 8. Proposal / Apply 安全链（不变量）

1. Agent/MCP/skill 只能产生 Proposal（TripChangeSet + Diff）。
2. proposalToken：一次性、10 分钟 TTL、绑定 baseRevision+baseHash。
3. apply-change 需 confirmed:true + token + expectedTripRevision；apply 后 proposal 记录删除（重放失败 closed）。
4. revision 锁贯穿所有写命令（REVISION_CONFLICT）；restore-trip 仅用户触发。
5. workspace 隔离：guest workspace cookie → 数据目录隔离。
6. 已完成（done/current）item 不可被 replan 改动（restoreLockedItems）。

## 9. 分支状态（2026-10-03 收敛后）

远端仅剩 `main`。本次收敛：
- 已合并：feat/open-source-readiness（含 itinerary-optimizer-v1、today-mode-v2 全部提交；merge commit 2f37067）。
- 已删除：上者 + itinerary-optimizer-v1 + today-mode-v2（提交均已可从 main 历史达）+ mcp-proposal-token（0/3，tip 在 main 内）。
- 已归档后删除（tag `archive/pre-restart-*`，6 个）：phase3-beta、transport-intelligence-v2、rag-knowledge-v1、social-intelligence-v1、runtime-unification-v1、voyage-runtime-provenance——孤儿历史（与现 main 无 merge-base），其工作已经 d6fa2e7 squash 进 main，PR #1-#7 均 MERGED/CLOSED。

## 10. 技术债清单

1. `tsconfig.json` include 仅 src/**——tests 不进 tsc，类型错误只能在 vitest 运行时暴露。
2. `src/services/ai/actions/planner.ts`（LLM 动作规划器）零调用方（死代码）；proposeChange 主路径是 planActionsWithRules 关键词 if-else（单命中、无联合推理）。mock.ts 存在第二套关键词链；agent 路由 demo regex 第三套。
3. `docs/TRAVEL_OS_ARCHITECTURE.md` 过时（仍写 TanStack Query / React Hook Form，均已卸载）。
4. skills/voyage/references/runtime-api.md 缺 6 个 UI 端命令。
5. RLS：0001 全 `using(true)` 被 0002 修复，但 bookings 表仍只写不读；`itinerary_items.reservation_id` 列悬空（Phase 6 接管）。
6. estimatedSpend = budget×0.85 拍脑袋 + 固定比例拆分（executor.estimateBudgetItems）——预算诚实化待 Phase 4.2/6。
7. 手写日期工具（无 date-fns/dayjs）；README 测试数字为快照口径。
8. `import "server-only"` 仅允许出现在 src/app/api/**（包未安装，Vitest 有 stub 而 tsx CLI 无）——见 git 历史 9e915b4 前后的教训。

## 11. 测试资产

vitest：58 文件 / 332 用例（brain 31、skill runtime/golden/proposal-token、planning、transport-intelligence、knowledge-rag、social、schema、e2e 之外的集成）。Playwright：7 spec（golden-trip、conversational-planning、day-focus、journey-map、mobile-nav、session-resume、transport-intelligence），端口 3005、确定性 env（VOYAGE_DEMO_MODE、LLM 关、key 清空）、workers 1。
