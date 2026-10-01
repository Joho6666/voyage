# Voyage · Open-source AI-native Travel OS

> **Voyage is an open-source AI-native Travel OS.**
> 不是攻略生成器，不是长篇 Markdown 机器，也不是臃肿的 OTA 销售平台。
> 它的使命是：**让一个真实的人，真的敢拿 Voyage 去完成一次旅行。**

**一屏了解：**

- **No account required** — 打开就能用，不需要注册登录（登录只为可选的跨设备同步）。
- **Local-first** — 行程、提案、知识都保存在你自己的 `.voyage/` 目录，不经过任何 Voyage 服务器。
- **Bring your own API keys** — 高德 / LLM / 社交数据全部自带 Key；不配任何 Key 也能用 Demo 模式完整体验。
- **Real POI / routes / weather** — 坐标、路线、天气来自真实 Provider，估算值永远带标注，绝不伪造。
- **Import 小红书 / 抖音 travel guides** — 粘贴链接或攻略文本，地点逐名核验后进入行程。
- **AI itinerary optimization** — 智能排程按地理聚类、时间窗、天气与你的节奏/步行偏好重排每天（Itinerary Optimizer v1）。
- **Today travel execution mode** — 旅途中一屏告诉你：下一站、怎么去、几点出发、还剩多少路、预计几点结束、要不要调整。
- **Skill + MCP support** — 同一套 Runtime 以 CLI、MCP server（Claude Desktop / Cursor）和 Web Agent 三种方式驱动。

## Provider 分级：从零配置开始

不需要配置任何 Key 也能完整体验。按需逐级解锁：

| 级别 | 需要什么 | 解锁什么 |
|---|---|---|
| **Level 0 · Demo** | 什么都不用 | `VOYAGE_DEMO_MODE=true`，内置重庆示例行程 + 矢量底图，完整体验规划 / Diff 确认 / Today 模式 |
| **Level 1 · AMap** | `AMAP_SERVER_KEY`（+ `NEXT_PUBLIC_AMAP_KEY` 真地图） | 真实 POI 搜索、真实路网路线、真实天气 |
| **Level 2 · LLM** | `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | 自然语言规划对话、攻略链接解析、Today Agent 多轮修改建议 |
| **Level 3 · Social / Offers** | `TIKHUB_API_KEY`（社交）、`MEITUAN_HT_TOKEN`（美团）、`FLIGGY_*`（飞猪） | 小红书/抖音攻略抓取、热度信号、机票与本地生活报价 |

任意级别缺失时，Voyage 会**降级并如实标注**（`providerStatus`: `REAL` / `ESTIMATED` / `CURATED` / `UNAVAILABLE`…），绝不把估算伪装成真实数据。

## 它是怎么工作的

用户输入一句简单愿望：
> “从桂林去重庆玩 3 天，2 个人，预算 2500，喜欢美食和夜景，不想每天走太多路。”

Voyage 在几秒钟内生成一个**真实的、结构化的、带高德坐标与路网、受天气感知、可持久化、随时可修改的完整旅行项目**。

用户旅途中只需说：
- “明天太累了” → 减少长距离攀爬，步行自动转打车与轻轨；
- “今天下雨了” → 触发 Rain Plan，露天步道平滑置换为室内三峡博物馆；
- “今天省 100 块” → 打车智能回退为地铁，餐饮结构微调；
- “推迟一小时” → 节点整体顺延，重新校准各段交通；

每一个自然语言指令，都会被编译成经过 Zod 校验的结构化 `TravelAction`，生成量化对比报告（`TripChangeSet`）呈现在 Diff 审阅弹窗中，**待用户确认后才应用**（一次性 proposalToken，10 分钟有效，防重放与篡改）。

---

## 界面预览

先和 Agent 把需求聊清楚，确认后再生成真实路线；生成之后仍然可以在行程里继续调整。

### 1. 对话式规划 · 边聊边形成旅行画像

<img src="docs/assets/screenshots/01-conversation-planning.png" alt="对话式规划：左侧对话，右侧实时更新的路线画像" width="880" />

### 2. 行程工作区 · 看哪一天就只显示哪一天

左侧只显示选中当天的行程，右侧地图只画当天的标记与路线；每条路线标注来源（高德实时 / 估算）。

<img src="docs/assets/screenshots/02-trip-workspace.png" alt="行程工作区：单日聚焦的行程列表与地图" width="880" />

### 3. 当天行程 + AI 助手 · 旅途中直接改

顶部直接给出「下一站」与一键导航，不需要自己解读整屏信息；右侧助手可以按天改行程，且只生成提案，需在 Diff 里确认才会写回。

<img src="docs/assets/screenshots/03-day-focus-assistant.png" alt="当天行程的下一站卡片与 AI 助手面板" width="880" />

### 4. 我的旅行 · 所有行程项目

<img src="docs/assets/screenshots/04-my-trips.png" alt="我的旅行列表" width="880" />

### 5. 数据源设置 · 密钥只在服务端

只显示每项能力「是否已配置」，不显示也不接收密钥值，避免凭据暴露到浏览器。

<img src="docs/assets/screenshots/05-data-sources.png" alt="API 与数据源设置页，只展示配置状态" width="880" />

---

## 功能亮点

- **Agent 主动牵引 + 工具调用可见**：今天页顶部根据行程事实（未来下雨、空白天、超预算、步行过长、未查报价、行前待办）主动给出可点击的下一步建议；Agent 回答时自动调用 15 个真实工具（高德 POI / 路线 / 天气 / 社交证据 / 报价），调用轨迹以徽标展示在回复卡中。LLM 只能生成提案，应用必须由你在 Diff 中确认。
- **多轮追问**：今天页的 AI 调整带最近 8 轮上下文——「再少一点」「换成下午」这类追问可以直接说。
- **攻略一键导入（小红书 / 抖音 / 微信）**：**在规划对话框里直接粘贴小红书/抖音链接**（短链也行），自动抓取正文、由高德逐个核实地点、生成时按链接原文顺序排进每天并画到地图上，同时生成打卡清单；也可在探索页检索小红书爆款笔记或粘贴任意平台的攻略原文。打钩一个地点，对应任务自动划掉。
- **单一创建路径**：一句话说出想去哪，Agent 追问缺的日期与人数，确认后生成真实路线；画像面板随时可手填。
- **探索页集成**：美食、住宿、活动的实时发现与「已收录」列表统一在探索页的类别 tab 中，发现结果可直接落到地图或行程。
- **单日聚焦**：看哪一天就只显示哪一天的列表与路线，「全部」一键切回全程视图。
- **移动端完整导航**：底部导航「行程 / 今天 / 地图 / 更多」，分享按钮手机可见；非行程页（我的旅行 / 设置）有全局底栏。
- **规划会话不再怕刷新**：会话 ID 持久化在本机、对话保存在服务端；回到规划页可「继续上次规划」，失效会话如实提示并清理。
- **运维加固**：付费接口（高德 / TikHub / LLM / 飞猪 / 规划）按调用方滑动窗口限流，超限返回 429 + Retry-After（单实例内存实现）；服务端结构化 JSON 日志覆盖降级与失败路径；访客工作区按 TTL 自动清理（默认 30 天，`VOYAGE_GUEST_TTL_DAYS` 可调，`0` 关闭）。

---

## 核心四大阶段 (Four Pillars)

| 阶段 | 职责定位 | 核心能力 |
|---|---|---|
| **1. Plan** | 行程规划与时间轴生成 | 目的地真实 POI 聚合，按地理就近聚类，自动排布正餐、游览时长与预算分布。 |
| **2. Explore** | 真实探索与商户发现 | 实时高德 POI 检索，支持“室内、夜景、免费、少走路”等精准标签筛选，杜绝伪造评分与空头价格。 |
| **3. Adapt** | 动态适应与差异审阅 | 全局 Command Bar (`Cmd+K`) 随时唤起，修改前量化展示步行减量、交通置换与费用差值，支持 10 步随时 Undo。 |
| **4. Travel** | 现场执行控制台 (Today) | 移动端优先单手操作：实时锁定下一站目标、出发与到达倒计时、直连高德 App 真实导航。 |

---

## 技术架构

```
UI Components (Next.js 15 App Router · React 19 · Tailwind v4 · Radix UI · Motion · dnd-kit)
      ↓
State & Control Layer (Zustand: useTripStore · useUiStore · useHistoryStore · CommandBar)
      ↓
AI Action & Diff Engine (TravelAction 3.0 · ActionPlanner · ActionExecutor · TripDiffModal)
      ↓
Travel Intelligence (Route Matrix · Transport Scoring · RAG Planning Context)
      ↓
Knowledge Engine (Hybrid Keyword + pgvector · Freshness · Confidence · Provenance)
      ↓
Service Facades & Routing Engine (RoutingService · WeatherContext · BookingIntent)
      ↓
Server Boundary (API Routes with 'server-only' secrets isolation)
  ├── AMap REST (POI Search, Geocoding, Walking/Driving/Transit Directions, Polylines)
  ├── OpenAI-compatible LLM (Chat Completions: Qwen, DeepSeek, GPT-4o)
  └── Supabase (Secure RLS bound to auth.uid() + In-Memory Fallback)
```

---

## 快速启动

```bash
cd voyage
npm install
npm run dev
```

浏览器打开 [http://localhost:3002](http://localhost:3002)

### 验证命令
```bash
npm run lint         # ESLint 代码规范检查 (0 errors, 0 warnings)
npm run typecheck    # TypeScript 严格类型检查 (0 errors)
npm test             # Vitest 单元与集成测试 (221 tests passed)
npm run build        # 生产环境 Turbopack 打包编译
npm run test:e2e     # Playwright 端到端验证 (25 条，含移动端导航与会话恢复)
```

---

## 环境变量配置 (`.env.local`)

| 环境变量 | 说明 | 缺省行为 |
|---|---|---|
| `NEXT_PUBLIC_AMAP_KEY` | 高德 JS API Key (Web 客户端) | 未配置时自动降级为 SVG 矢量投影底图 |
| `NEXT_PUBLIC_AMAP_SECURITY_CODE` | 高德 JS API 安全密钥 | 配合 JS Key 使用 |
| `AMAP_SERVER_KEY` | 高德 Web 服务服务端 REST Key | 未配置时走精选真实地点库与 Haversine 估算 |
| `LLM_BASE_URL` | OpenAI 兼容的大模型 API 根地址 (如方舟/DeepSeek) | 未配置时自动切入规则引擎 |
| `LLM_API_KEY` | 服务端模型 API Key | 保护在服务端，绝不向浏览器泄露 |
| `LLM_MODEL` | 模型名称 (如 `deepseek-v3`, `gpt-4o-mini`) | 默认 `gpt-4o-mini` |
| `EMBEDDING_BASE_URL` | OpenAI-compatible Embeddings API 根地址 | 未配置时 RAG 自动降级为关键词/本地知识检索 |
| `EMBEDDING_API_KEY` | Embedding API Key | 仅服务端使用 |
| `EMBEDDING_MODEL` | 1536 维 Embedding 模型 | 未配置时不执行语义向量检索 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目地址 | 未配置时自动无感运行在内存 Demo 模式 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 客户端匿名密钥 | 严格受 `0002_rls_secure.sql` 行级安全控制 |
| `TIKHUB_API_KEY` | TikHub 社交检索（小红书 / 抖音 / 微博 / 微信搜一搜） | 未配置时社交证据如实显示为不可用 |
| `VOYAGE_GUEST_TTL_DAYS` | 访客工作区过期天数 | 默认 `30`，设为 `0` 关闭自动清理 |

---

## 文档索引

- [`docs/GOLDEN_TRIP.md`](docs/GOLDEN_TRIP.md) — 桂林 ↔ 重庆 3天2夜 核心黄金验收基准
- [`docs/PHASE3_AUDIT.md`](docs/PHASE3_AUDIT.md) — 深度代码库 15 维度审计报告
- [`docs/PHASE3_IMPLEMENTATION_PLAN.md`](docs/PHASE3_IMPLEMENTATION_PLAN.md) — Phase 3 详细执行计划
- [`docs/REAL_WORLD_PROVIDER_GUIDE.md`](docs/REAL_WORLD_PROVIDER_GUIDE.md) — 高德/天气/预订/Supabase 接入指南
- [`docs/TRAVEL_ACTIONS.md`](docs/TRAVEL_ACTIONS.md) — 24 项 TravelAction 规格与 Diff 预览说明
- [`docs/BETA_ACCEPTANCE.md`](docs/BETA_ACCEPTANCE.md) — 18 项 Beta 用户路径通关报告
- [`knowledge/README.md`](knowledge/README.md) — Travel Knowledge RAG 数据格式、入库与检索说明

---

## 联系作者

使用中遇到问题、想提建议、或者想聊聊这个项目，欢迎直接加微信：

<img src="docs/assets/wechat-joho.jpg" alt="作者微信二维码" width="280" />

> 也可以在 GitHub Issues 里留言。微信个人二维码会定期更换，若扫码失效请先提 Issue。
