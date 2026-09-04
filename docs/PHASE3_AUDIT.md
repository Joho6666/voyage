# Voyage Phase 3 代码库审计报告 (PHASE3_AUDIT.md)

> 审计日期：2026-09-05  
> 审计对象：`Joho6666/voyage` (Phase 1 + Phase 2 交付基线)  
> 审计目标：分析现有实现度、Mock 遗留点、数据流与架构断点，为 Phase 3 Real World Travel Beta 提供改造基准。

---

## 一、当前实际实现程度

Voyage 当前完成了作为 MVP 原型的大部分骨架：
- **前端工作台**：Trip Workspace 双栏架构（左侧行程 / 右侧地图），桌面端支持分栏，移动端支持基于 `motion/react` 的三档底栏抽屉（Collapsed / Half / Full）。
- **状态管理**：基于 Zustand 构建了三个独立 store（`useTripStore`, `useUiStore`, `useHistoryStore`），支持单日内基于 `@dnd-kit` 的地点拖拽排序。
- **动作执行器 (Action Executor)**：实现了 12 个 `TravelAction` 类型（`MOVE_ITEM`, `REMOVE_ITEM`, `ADD_ITEM`, `REPLACE_ITEM`, `OPTIMIZE_DAY`, `REDUCE_WALKING`, `REDUCE_BUDGET`, `CHANGE_TRANSPORT`, `RECOMMEND_FOOD`, `RECOMMEND_PLACES`, `CHANGE_TIME`, `CHANGE_DAY`），通过纯函数执行器对 Trip 副本进行操作。
- **历史记录**：`useHistoryStore` 实现了 10 步深度快照栈（`structuredClone`），支持基础的 Undo / Redo。
- **持久化**：具备 Supabase Repository 与 Memory Fallback 双实现，`trips.payload` 能够实现完整 Trip JSON 的回环读写。

**与真实可用旅行系统的差距**：
当前系统处于“演示闭环已通，但真实世界旅行断裂”的状态。路线计算依靠假定速度与直线距离，天气没有影响决策，AI 缺少对比审阅机制，Today 页面未接入实际执行逻辑，数据库权限处于完全开放状态。

---

## 二、Mock 数据还存在在哪里

| 模块 | 文件路径 | Mock 内容与表现 |
|---|---|---|
| **Demo 行程** | `src/data/demo/chongqing.ts` | 硬编码了完整的重庆 3 天 2 夜行程（21 个地点、12 个行程节点、3 家酒店、3 家餐馆、3 个活动、2 段高铁、12 个任务、6 项预算）。所有非 AMap 检索数据全部来源于此。 |
| **AI 代理降级** | `src/services/ai/mock.ts` | `MockTravelAgent` 使用简单的中文关键词（"赶", "累", "省", "走", "美食" 等）返回静态建议提案。 |
| **预订外链** | `src/services/booking/mock.ts` | `MockBookingProvider` 生成全部指向 `https://example.com/booking/...` 的死链。 |
| **地图降级** | `src/components/map/MockMap.tsx` | 无高德 JS Key 时渲染带静态散点投影的 SVG 地图，无路网支持。 |
| **POI 检索降级** | `src/app/api/amap/poi/route.ts` | 无 `AMAP_SERVER_KEY` 时返回 `{ source: "mock", pois: [] }`。 |
| **天气降级** | `src/app/api/weather/route.ts` | 无高德 Key 时返回 `{ source: "mock", days: [] }`。 |
| **行程内置天气** | `src/app/api/agent/create/route.ts` | `buildDays()` 中硬编码了 3 种天气循环（阴天 24℃、小雨 18℃、晴天 22℃），并未取用真实天气。 |
| **仓储降级** | `src/services/trips/repository.ts` | 无 Supabase 配置时使用内存 Map（`MemoryTripRepository`），进程重启即丢失。 |

---

## 三、哪些 Provider 是真正实现

| Provider | 实现状态 | 实际调用的能力 | 限制与短板 |
|---|---|---|---|
| **AMap POI Search** | **真正实现** | `/v3/place/text` 关键词与城市检索，带经纬度、地址、评分、人均。 | 仅在服务端 API 路由中调用；缺少基于位置的周边/分类增强。 |
| **AMap Geocoding** | **真正实现** | `/v3/geocode/geo` 地址解析为经纬度及城市 adcode。 | 仅在天气路由中用于解析城市代码。 |
| **AMap Weather** | **真正实现** | `/v3/weather/weatherInfo` 多天预报查询。 | 仅用于展示；未进入决策流水线。 |
| **AMap Route (Walking / Transit)** | **代码已写，但从未调用 (Dead Code)** | `amapWalkingRoute()` 与 `amapTransitRoute()` 已在 `amap-rest.ts` 中实现。 | **核心短板**：`recomputeDay()` 依然 100% 使用 Haversine 直线距离推算，真实的步行和公交 API 从未被接入调度！驾车 API 尚未编写。 |
| **Supabase Repository** | **真正实现** | Upsert 写入 `trips` 表的 `payload` jsonb 列。 | 子表通过非事务方式先 delete 后 insert；查询时仅读取 `payload`，规范化子表实际成为只写单向数据。 |
| **OpenAI-compatible LLM** | **真正实现** | `/api/agent/create` 和 `/api/agent/plan-actions` 调用 `chatJson()`。 | 单次请求无历史对话记忆；Prompt 未包含实时预算与交通阻抗。 |
| **Booking Provider** | **纯 Mock** | 无任何真实外部 OTA Deeplink 生成。 | 全部为 example.com。 |

---

## 四、哪些页面只有 UI，没有真实数据闭环

1. **`/trip/[id]/food`（美食推荐页）**：
   - 数据源硬编码为 `chongqingTrip.restaurants`（仅 3 家）。
   - 顶部的菜系筛选标签（"火锅", "江湖菜", "小吃", "茶饮", "夜市"）纯静态，无过滤事件绑定。
2. **`/trip/[id]/hotels`（住宿清单页）**：
   - 数据源硬编码为 `chongqingTrip.hotels`（仅 3 家）。
   - 预订按钮全部指向 Mock 外链，无区域分析与真实比价意图。
3. **`/trip/[id]/transport`（大交通与市内交通页）**：
   - 数据源硬编码为 2 段桂林-重庆高铁，点击“查看班次”仅弹出 Toast 提示“车次查询为演示数据”。
4. **`/trip/[id]/activities`（当地特色活动页）**：
   - 仅显示硬编码的 3 项活动，没有与目的地真实 POI 联动。
5. **`/trip/[id]/today`（Today 模式）**：
   - 硬编码显示 Day 2，无法根据真实日期切换；
   - “开始导航”按钮仅弹出 Toast“导航使用 Mock Location / 高德外链”，无真实 App / Web 跳转协议；
   - 4 个快捷操作直接触发并自动保存，无修改前后的量化 Diff。

---

## 五、哪些功能存在重复实现

1. **距离计算**：
   - `src/lib/utils.ts` 中的 `haversineMeters()` 与 `src/services/map/controller.ts` 中的点间距离推算逻辑各自独立存在。
2. **天气获取与默认值**：
   - `amap-rest.ts:amapWeather()` 能获取真实天气预报，但 `src/app/api/agent/create/route.ts:buildDays()` 却自行硬编码了一套 `weatherPresets`。
3. **地点向行程添加**：
   - `AddToDay.tsx` 弹窗组件与 AI 执行器的 `ADD_ITEM` 在校验和默认耗时分配上存在两套逻辑。

---

## 六、哪些代码是 Phase 1 遗留下来的临时代码

1. **SQL RLS 策略开放**：
   `supabase/migrations/0001_init.sql` 中全部策略写为：
   `create policy "..." on ... for all using (true) with check (true);`
   直接破坏了 Supabase 行级安全防护。
2. **无归属的孤立表**：
   `profiles` 表在迁移中已建立，但在业务代码中从未被使用或关联。
3. **硬编码演示用户标识**：
   侧边栏和组件中硬编码了用户名 "Zhou" / "测试用户"，没有接入 Auth Session。
4. **演示 Trip ID 常量到处引用**：
   `DEMO_TRIP_ID = "chongqing-2026"` 直接用于 `/trips` 列表的默认跳转，缺乏真实的多行程管理支持。

---

## 七、当前 Trip State 的数据流

```
[用户输入] 
   ↓
[Client: OpenAITravelAgent] 
   ↓ (POST /api/agent/create 或 /api/agent/plan-actions)
[Server: Next.js API Route (server-only)]
   ├─ 调用 AMap REST 抓取 POI 候选
   ├─ 调用 LLM 生成日行程 Outline 或 TravelAction[]
   ├─ 执行器 executeActions() 计算新状态
   ├─ recomputeTrip() 重新用 Haversine 刷新时间点与路段
   └─ tripRepository.save() 写入 Supabase / Memory
   ↓ (返回 Trip JSON)
[Client: Zustand hydrateTrip()]
   ↓
[useTripStore.setState({ trip })]
   ├─ 触发 ItineraryPanel 渲染
   ├─ 触发 MapCanvas (AMapCanvas / MockMap) 重新绘制 Marker 与 Polyline
   └─ 用户点击 Marker / Card → 更新 useUiStore (selectedPlaceId / hoverPlaceId)
```

**关键隐患**：
- 客户端每次与 AI 交互，都要把完整的 Trip JSON 全部上报服务端（缺乏差异同步协议）；
- 任何细微修改（例如拖拽一个卡片），都需要全量保存回写数据库。

---

## 八、Client / Server Boundary 是否合理

- **合理之处**：
  - `AMAP_SERVER_KEY`、`LLM_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 严格锁在服务端，关键文件声明了 `import "server-only"`。
  - 前端组件不直接调用高德 REST 或 OpenAI SDK，而是通过统一的 Facade 模式访问 `/api/*`。
- **不合理之处**：
  - `src/services/trips/repository.ts` 在客户端（`trip/[id]/layout.tsx`）与服务端（`/api/agent/*`）均有直接引用。在本地无 Supabase 凭据时，服务端 API 写入的是服务端的 `MemoryTripRepository` 内存 Map，而客户端渲染读取的是浏览器的 `MemoryTripRepository`，两端内存不共享，容易导致数据未同步。
  - 前端所有页面均为 `"use client"`，Next.js SSR 的首屏加载优势未发挥。

---

## 九、Supabase 是否真正完成用户级持久化

**答案：否。**
1. **RLS 完全裸奔**：全部表采用 `using (true)`，持有 `anon_key` 的任意客户端可以对任意用户的行程执行删改查。
2. **缺乏身份认证 (Auth)**：客户端未初始化会话侦听器，未提供登录/注册入口，`trips.owner_id` 实际上为 null 或固定缺省值。
3. **单向非事务保存**：`SupabaseTripRepository.save()` 先 upsert `trips` 主表，然后对 `places`, `trip_days`, `itinerary_items`, `route_segments`, `budget_items`, `trip_tasks` 循环执行 `delete where trip_id = ...` 然后 `insert`。若网络中途断开，子表数据会遗失（主表 `payload` 依然完整，但结构化子表损坏）。

---

## 十、AMap 路线是否真正使用真实 Direction API

**答案：完全没有使用。**
- `src/services/map/amap-rest.ts` 中确实编写了 `amapWalkingRoute()` 和 `amapTransitRoute()`；
- 但是在 `src/services/routing.ts` 的核心函数 `recomputeDay()` 中：
  ```ts
  const meters = haversineMeters(a, b);
  const transit = estimateTransit(meters);
  nextSegments.push({
    id: uid("seg"),
    dayId,
    fromItemId: from.id,
    toItemId: to.id,
    mode: transit.mode,
    meters,
    minutes: transit.minutes,
    label: transit.label,
  });
  ```
  全是直线距离估算！
- 缺失驾车路线计算（`amapDrivingRoute`）；
- 步骤明细（`steps`）被抛弃；
- `RouteSegment` 中没有区分 `estimated: true / false` 的标记字段；
- 地图上的路线折线只有直连点，没有真实道路贴合 Polyline。

---

## 十一、Today 页面现在到底能做什么

当前 `src/app/trip/[id]/today/page.tsx` 的真实能力：
1. **展示固定 Day 2**：代码写死 `day = trip.days[1] ?? trip.days[0]`，不感知当天真实日期；
2. **显示当前/下一站**：根据状态判定下一站，计算直线估算交通耗时；
3. **导航按钮为假按钮**：点击弹窗 Toast；
4. **4 个快捷文本交互**：点击“太累了”发送给 AI，AI 自动在后台修改并直接保存，用户无法在修改前审阅变化幅度；
5. **午餐静态推荐**：直接取行程外第一个 `category === "food"` 的地点；
6. **无单手操作体验**：大量卡片堆叠，缺乏在旅途移动场景下的清晰度。

---

## 十二、Explore / Food / Hotels 是否使用真实 POI

- **Explore**：
  - 当配置 `AMAP_SERVER_KEY` 时，**使用了高德真实 POI 搜索**。
  - 但缺乏精细标签（“室内”, “夜景”, “附近”），且结果缺少营业时间校验。
- **Food**：
  - **使用静态 Mock**（3 家重庆餐厅），没有对接高德餐饮 POI。
- **Hotels**：
  - **使用静态 Mock**（3 家重庆酒店），预订全为假链接。

---

## 十三、Weather 是否真正影响 TravelAction

**答案：完全不影响。**
- 天气数据在 `amapWeather()` 中被抓取后，仅作为天气的文本与图标渲染；
- `ActionPlanner` 的系统提示词中虽附带了当天天气描述，但没有任何针对下雨、高温的约束规则；
- AI 生成修改时不会因为“下雨”自动替换室外景点为室内博物馆，也不会触发下雨预警。

---

## 十四、当前 AI Agent 是否具备上下文感知

**仅具备局部感知，缺乏全局决策上下文**：
- **已具备**：知道当前所有行程项的名称、时间、类型、预估停留时间、未访问的候选地点列表。
- **缺失**：
  - **无实时预算感知**：Prompt 中没有剩余预算、各项花费比例；
  - **无疲劳度感知**：没有累积步行里程与体力量化；
  - **无天气因果推理**：下雨时不知道主动过滤室外 POI；
  - **无多轮对话记忆**：每一次 plan-actions 请求都是无状态的单次交互。

---

## 十五、当前测试是否覆盖关键用户路径

**测试覆盖率极度匮乏**：
- 现有测试仅 5 个文件，集中在纯函数与工具类（`executor.test.ts`, `routing.test.ts`, `schema.test.ts`, `repository.test.ts`, `safe-url.test.ts`）。
- **没有组件测试**：尽管装了 `@testing-library/react`，但没有一个 React 组件测试。
- **零 E2E 测试**：没有安装 Playwright，没有端到端自动化测试。
- **未测试的核心路径**：
  - 用户在首页输入需求 -> 生成 Trip -> 页面加载完成；
  - 拖拽调整行程 -> 路线与时间重算；
  - 自然语言命令 -> 生成 Proposal Diff -> 用户确认 -> 数据持久化；
  - 刷新页面数据不丢失。

---

## 结论与 Phase 3 改造方向

Voyage Phase 3 的核心使命不是扩展更多边缘页面，而是**彻底消灭上述 15 个断点**：
1. 贯通高德真实驾车、步行、公交路线与真实 Polyline，明确标识估算与真实路况；
2. 建立 `TripChangeSet` 与 Diff 预览审阅机制（用户掌握确认权，拒绝暗中黑盒改动）；
3. 将 Today 重构为移动端优先的旅行现场执行控制台；
4. 让天气作为决策参数驱动 `RAIN_PLAN` 等实际行动；
5. 收紧 Supabase RLS 策略至 `auth.uid()`，支持游客无门槛模式与多行程管理；
6. 引入 Playwright E2E 自动化测试，确保黄金用例（Golden Trip）每一条链路坚不可摧。
