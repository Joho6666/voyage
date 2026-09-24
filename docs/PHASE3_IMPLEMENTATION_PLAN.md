# Voyage Phase 3 — Real World Travel Beta 详细实施计划 (PHASE3_IMPLEMENTATION_PLAN.md)

> 阶段目标：从技术可运行的 AI Travel MVP 升级为用户真实可用的 Travel OS Beta。

---

## 阶段划分与里程碑

```
Phase 3.1: 审计与基线建立 (Audit & Golden Trip Baseline)  ✅
Phase 3.2: 真实地图与高德路线引擎 (Real Map & Routing Engine)
Phase 3.3: TravelAction 3.0 与提案差异审阅 (Action 3.0 & Diff Preview)
Phase 3.4: 天气情报引擎接入决策 (Weather-Aware Agent)
Phase 3.5: 现场执行模式 Today 深度重构 (Execution-First Today Mode)
Phase 3.6: 真实探索与预订意图层 (Real Explore & Booking Intent)
Phase 3.7: 全局指挥台 Command Bar 与视觉去 AI 味 (Command Bar & De-AI UI)
Phase 3.8: Supabase 认证与 RLS 行级安全收紧 (Auth & Secure RLS)
Phase 3.9: Playwright E2E 自动化测试与可观测性 (E2E Tests & Telemetry)
Phase 3.10: 最终验收、CI 校验与文档交付 (Release Verification)
```

---

## 任务清单与技术细节

### Phase 3.2 真实地图与高德路线引擎 (P0)
- **目标**：彻底淘汰 Haversine 直线假想路线；支持高德驾车、步行、公交真路线与 Polyline，建立 `RouteSegment` 来源追踪与状态标识。
- **涉及文件**：
  - `src/types/travel.ts`: 扩展 `RouteSegment` 字段（`fromPlaceId`, `toPlaceId`, `distanceMeters`, `durationMinutes`, `polyline`, `steps`, `provider`, `providerRouteId`, `estimated`, `updatedAt`）。
  - `src/schemas/trip.ts`: 同步更新 Zod 校验规则，保持类型安全。
  - `src/services/map/amap-rest.ts`:
    - 新增 `amapDrivingRoute(origin, destination)`
    - 新增 `amapReverseGeocode(lng, lat)`
    - 改造 `amapWalkingRoute`, `amapTransitRoute`，完整提取 steps 步骤指引与高精度 polyline
  - `src/app/api/amap/route/route.ts`: 新增服务端多模态路线规划 API，内置 LRU 内存缓存防止重复消耗配额。
  - `src/services/routing.ts`:
    - 改造 `recomputeDay`，保留快速同步估算作为乐观 UI 更新；
    - 新增 `recomputeDayWithRealRoutes`，并发拉取高德真实路网；
    - 明确标记 `estimated: false` (真实高德) 与 `estimated: true` (直线降级)。
  - `src/components/itinerary/TravelSegment.tsx`:
    - 增加“高德实时路线 / 预估直线距离”真实度徽章与耗时/里程展示。

### Phase 3.3 TravelAction 3.0 与差异预览系统 (Trip Diff Preview)
- **目标**：新增 12 个贴合旅行现场的核心动作，实现“自然语言 -> 动作规划 -> 纯函数执行 -> 前后差异计算 -> 用户审阅确认 -> 持久化回写”完整闭环。
- **涉及文件**：
  - `src/services/ai/actions/types.ts`: 扩充 `TRAVEL_ACTION_TYPES`（`RAIN_PLAN`, `DELAY_DAY`, `START_EARLIER`, `SKIP_NEXT`, `FIND_NEARBY_FOOD`, `REDUCE_TODAY_WALKING`, `REDUCE_TODAY_BUDGET`, `CHANGE_NEXT_PLACE`, `CHANGE_ROUTE_MODE`, `MOVE_INDOOR`, `EXTEND_STAY`, `SHORTEN_STAY`）。
  - `src/services/ai/actions/schemas.ts`: 为所有新 Action 编写严格的 Zod Schema 校验器。
  - `src/services/ai/actions/executor.ts`: 实现纯函数执行逻辑，绝不直接暗改 Trip，全部经由 Executor 派发。
  - `src/types/diff.ts` & `src/services/ai/diff.ts`:
    - 定义通用结构 `TripChangeSet`；
    - 自动对比修改前后的步行总里程、预估交通费用、时间位移、新增/删除/替换明细。
  - `src/components/ai/TripDiffModal.tsx`:
    - 弹窗展示量化对比卡（如：步行 `4.8km → 1.9km (-60%)`，费用 `+¥13`，节省时间 `35min`）；
    - 提供明确的“应用修改 (Apply)”与“取消 (Cancel)”操作。

### Phase 3.4 天气情报引擎接入决策
- **目标**：天气不再是展示摆件，成为 AI 动作规划与现场提示的核心输入。
- **涉及文件**：
  - `src/services/weather/context.ts`: 建立 `WeatherContext`（包含雨天判定、高温判定、大风预警等布尔特征及出行建议）。
  - `src/services/ai/actions/planner.ts`: 将 `WeatherContext` 注入系统 Prompt，当预测到雨天时自动倾向推荐室内活动并准备下雨预案。
  - `src/app/api/weather/route.ts`: 增强对城市天气的标准化返回。

### Phase 3.5 现场执行模式 Today 深度重构
- **目标**：单手可操作、低认知负担的旅行当天移动端控制台。
- **涉及文件**：
  - `src/app/trip/[id]/today/page.tsx`:
    - 动态检测当天日期，自动对齐真实 Day；
    - 顶部实时出行状态（下一站、建议出发/到达时间、交通方式）；
    - 一键直连高德地图 App 的“开始导航” Deeplink 协议；
    - 单手大按钮行动网格：“少走路”、“下雨方案”、“推迟一小时”、“跳过这站”、“找附近吃”；
    - 所有按钮统一通过 Action 触发并拉起 `TripDiffModal`。

### Phase 3.6 真实探索与预订意图层
- **目标**：杜绝伪造评分与空头链接，构建真实可信的商户探索与预订意向层。
- **涉及文件**：
  - `src/app/trip/[id]/explore/page.tsx`:
    - 支持 8 大真实分类筛选；
    - 真实地点卡片：无真实评分时不显示假星星，明确标明“高德真实 POI”或“精选地点”。
  - `src/types/booking.ts`: 设计 `BookingOption` 与 `BookingIntent`。
  - `src/app/trip/[id]/hotels/page.tsx` & `food/page.tsx`:
    - 接入高德/携程真实 Deeplink 搜索链接；
    - 提供区域住宿建议与人均真实预估。

### Phase 3.7 全局指挥台 Command Bar 与视觉去 AI 味
- **目标**：Cmd+K / Ctrl+K 统一控制中心，全站去 AI 模板化。
- **涉及文件**：
  - `src/components/command/CommandBar.tsx`:
    - 基于 `cmdk` 构建，支持全局快捷键唤起；
    - 输入命令如“明天推迟一小时”、“今晚少走路”直接触发 ActionPlanner 并弹出 Diff 审阅。
  - `src/app/page.tsx`: 首页极简改版，一句话“Tell Voyage where you're going.”搭配即时输入框。
  - `src/app/trips/page.tsx`: 升级为 Upcoming / Active / Past 三段式专业旅行清单。
  - `src/app/globals.css`: 统一 Token，去除紫色炫光和过度毛玻璃，拥抱 Linear / Apple Maps 高级质感。

### Phase 3.8 Supabase 认证与 RLS 行级安全收紧
- **目标**：消除安全隐患，实现真实用户空间隔离，同时无缝兼容本地 Demo 模式。
- **涉及文件**：
  - `supabase/migrations/0002_rls_secure.sql`:
    - 移除全部 `using (true)` 策略；
    - 主表收紧为 `trips.owner_id = auth.uid()`；
    - 7 张子表通过 `exists (select 1 from trips where trips.id = ... and trips.owner_id = auth.uid())` 实现行级级联隔离。
  - `src/services/supabase/auth.ts`: 实现轻量 Auth 管理与匿名游客会话。
  - `src/services/trips/supabase.ts`: 增加 `owner_id` 注入与安全隔离检查。

### Phase 3.9 Playwright E2E 自动化测试与可观测性
- **目标**：Golden Trip 7 大核心用户路径全部通过端到端自动化验证。
- **涉及文件**：
  - `playwright.config.ts`: Playwright 测试配置文件。
  - `tests/e2e/*.spec.ts`:
    - `01-create-trip.spec.ts` (首页输入到生成旅行)
    - `02-drag-reorder.spec.ts` (拖拽排序触发路线重算)
    - `03-ai-reduce-walking.spec.ts` (AI 少走一点 -> Diff 弹窗 -> 应用)
    - `04-refresh-persistence.spec.ts` (刷新页面数据不丢失)
    - `05-weather-rain-plan.spec.ts` (下雨方案替换室内 POI)
    - `06-undo-action.spec.ts` (撤销恢复快照)
    - `07-explore-add-poi.spec.ts` (Explore 搜索添加景点到行程)
  - `src/lib/telemetry.ts`: 轻量无敏感信息脱敏埋点。
  - `src/lib/errors.ts`: 统一错误边界与友好提示。

### Phase 3.10 最终验收、CI 校验与文档交付
- **目标**：全套工程质量关卡全部通过，发布 Phase 3 Beta。
- **验证命令**：
  ```bash
  npm run lint
  npm run typecheck
  npm test
  npm run test:e2e
  npm run build
  ```
- **更新文档**：`README.md`, `docs/TRAVEL_ACTIONS.md`, `docs/REAL_WORLD_PROVIDER_GUIDE.md`, `docs/BETA_ACCEPTANCE.md`。
