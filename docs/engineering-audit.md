# Voyage 工程审计(Audit V1)

> 日期:2026-10-05 · 基线:main@8cb13ad · 方法:三路并行代码扫描(架构 / 质量 / AI 资产)+ 人工抽查验证,所有 file:line 均经核实
> 基线状态:typecheck ✅ · lint ✅ · vitest 67 文件 / 392 用例全过 ✅ · 工作区干净

---

## 1. 当前项目到底能做什么

Voyage 是一个**本地优先的 AI 原生旅行操作系统**("Travel OS"),不是攻略生成器,也不是 OTA。已验证可用的能力:

- **一次运行时,四个入口**:`VoyageSkillRuntime`(`src/skill/runtime.ts`,2274 行,~46 个命令)同时服务 Web API(`/api/voyage/command`)、LLM Agent(`/api/agent/tools`,22 个白名单工具 + 3 轮 tool-calling 循环)、Skill CLI(`skills/voyage/scripts/voyage.mjs`)、MCP 服务器(`packages/voyage-mcp`,22 个工具)。适配器不含业务逻辑。
- **对话式行程创建**:`/new-trip` → 规划会话 → profile 提取(规则+LLM)→ 候选白名单 LLM 大纲 → 约束评估/修复(`brain/constraints.ts`,835 行)→ 确定性排程 → 带来源标注的 Trip。
- **提案-确认式修改**:任何修改都走 `propose-change` → 量化 Diff(步行米数、天数密度等)→ 一次性 `proposalToken`(10 分钟 TTL、sha256 存储、绑定 tripId+revision+changeSet 哈希)→ 用户确认后 `apply-change`。LLM 被**硬性禁止**自调 `apply_change`(`agent/tools/route.ts:471-474`)。
- **四级能力降级,BYO-Keys**:L0 Demo(内置重庆行程)→ L1 高德(POI/路线/天气)→ L2 LLM(规划/提取/Agent)→ L3 社交/报价(TikHub/美团/飞猪)。所有数据带 `providerStatus: REAL/ESTIMATED/CURATED/UNAVAILABLE`,估算不冒充真实。
- **Phase 6 行程状态引擎**:预订(6 命令)、旅行事件(4 命令)、影响分析、事件重规划(9 策略)、TripState 引擎、执行台 Today console、旅人偏好记忆(强制披露)。
- **多渠道攻略导入**:小红书/抖音链接解析(≤3 跳短链 + SSRF 校验)、LLM 地名提取 + 逐点高德验证、签到任务自动挂接。
- **混合 RAG**:knowledge/ 语料 → Supabase pgvector,RRF 融合检索,关键词 + 本地精选双层兜底。
- **行程优化器 v1**:确定性最远插入 + k-means,同输入同输出,带 `decisions[]` 解释。
- **PWA/离线**:service worker + 离线缓存 + 专用 E2E。
- **可移植 Skill 包**:`skills/voyage/` 可拷入外部 Agent Harness,`runtime.lock.json` 锁定提交。

## 2. 当前项目不能做什么

- **不能多人/多实例部署**:限速(`api-guards.ts`)、routeCache、访客工作区全是单实例内存/文件假设,水平扩展即失效。
- **不能保证 LLM 供应商质量**:`llm.ts` 单次调用无退避重试;畸形 tool args 静默丢弃(`llm.ts:55-64`),模型不知道自己调用失败。
- **不能离线生成**:LLM/高德/TikHub 全部外部依赖;fixture 与 demo 是唯一无外部依赖路径。
- **不能追踪预算**:Supabase `bookings` 表只写不读;`itinerary_items.reservation_id` 列悬空(被 Phase 6 payload 内嵌预订取代)。
- **不能覆盖全部真实票务**:飞猪/美团需合作方凭证,未配置时诚实返回 `NO_PROVIDER_CONFIGURED`;抖音端点在上游 400(CHANGELOG 记录)。
- **不能检验组件层正确性**:vitest 不收 `.tsx`,React 组件零单元测试(见 §12)。

## 3. 项目真实完成度

**总体 ≈ 85%——不是 Demo,是有纪律的工程系统。**

- 数据面口径:src 212 文件 / ~31.6k 行;服务层 67 文件 25 子域;zod v4 契约全覆盖;~394 单元用例 + 28 E2E 用例;CI 全链路(lint→typecheck→vitest→build→Playwright)。
- 完成度最高的部分:运行时命令层、提案安全、测试文化(零 TODO/FIXME/as any)、降级诚实性。
- 完成度最低的部分:组件测试、Supabase 持久层验证、部署形态(单实例假设)、knowledge 语料(管线完备但语料只有 4 篇种子文档)。

## 4. 架构图

```
┌────────────────────────── 一次运行时,四个入口 ──────────────────────────┐
│  Web UI (Next 15/React 19)      LLM Agent          Skill CLI     MCP    │
│  /trip/[id]/* 等页面            /api/agent/tools    voyage.mjs   stdio  │
│        │                            │                 │            │     │
│        ▼                            ▼                 ▼            ▼     │
│  /api/voyage/command ────────────────────────────── VoyageSkillRuntime │
│  /api/voyage/{planning,share,import,...}   (src/skill/runtime.ts)      │
│  /api/amap/{poi,route}                       ~46 命令,zod 契约          │
│                                              envelope voyage.skill.v1  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   ▼
        ┌────────────────── 服务层(src/services,25 子域)────────────────┐
        │ planning/ brain/ impact-engine trip-state/ replan/ itinerary-  │
        │ optimizer/ today/ memory/ knowledge/ social/ booking/ meituan/ │
        │ map/ weather/ routing/ ai/ transport/ config/ media/ trips/    │
        └──────┬──────────────┬──────────────┬──────────────┬───────────┘
               ▼              ▼              ▼              ▼
        JsonSkillRepository  AMap REST     LLM(OpenAI     TikHub/美团/飞猪
        (.voyage/ JSON,      (QPS 池,      兼容 fetch,    (凭证可选,
        访客 UUID 隔离)       并发 3)       60s 超时)      未配置即降级)
               │
               ▼  可选
        Supabase(trips payload jsonb + pgvector RLS auth.uid())
```

## 5. 数据流(修改一条行程为例)

1. 用户在聊天输入"第二天少走点" → `POST /api/agent/tools`
2. demo 模式下 regex 直通(`route.ts:346-363`);否则进入 3 轮 tool-calling 循环
3. LLM 调 `propose_change` → runtime 校验 → `planActionsWithRules`/规则链 → actions → executor → `computeTripChangeSet` 量化 Diff
4. 提案入库,`proposalToken` 签发(哈希存储);响应带工具调用轨迹徽章
5. 用户在 Diff 弹窗确认 → `apply-change`(token 一次性消费 + revision 校验)
6. 写入 `.voyage/guests/<uuid>/trips/`;已登录用户可选 Supabase 同步(delete-then-insert,非事务,见 §9)

## 6. Agent Flow(LLM Agent 工具循环)

- 白名单 22 工具声明于 `agent/tools/route.ts:55-78`;每轮 `chatWithTools`(temp 0.2,max_tokens 2500)→ 最多 3 轮
- 每个工具结果经 `safeToolResult`(:122-209)裁剪;历史限 12 条/12k 字符
- 系统提示词内联组装(:376-390):反编造规则、提案纪律、`[dayId:xxx]` 聚焦约定、事件决策序(get_trip_state→get_active_events→analyze_event_impact→propose_event_replan)、偏好记忆披露行
- 事件重规划链:`record/simulate-travel-event` → trip-state 引擎 → impact-engine(规则矩阵)→ event-replan(9 策略)→ 提案

## 7. 关键模块(按风险×重要性排序)

| 模块 | 行数 | 职责 | 测试 |
|---|---|---|---|
| `src/skill/runtime.ts` | 2274 | ~46 命令调度,createTrip(~270 行)/replanTrip(~180 行) | skill/* 19 文件 + golden |
| `src/features/new-trip/NewTripExperience.tsx` | 1091 | 对话规划 UI,修订冲突/重试 | ❌ 仅 4 条 E2E 间接覆盖 |
| `src/services/brain/constraints.ts` | 835 | 预订硬约束评估/修复 | brain/* 5 文件 |
| `src/store/trip-store.ts` | — | 乐观 UI + 修订锁中心状态 | ❌(history/planning store 有) |
| `src/services/ai/actions/executor.ts` | 584 | 24 种 TravelAction 执行 | ✅ |
| `src/app/api/agent/tools/route.ts` | 530 | Agent 工具循环 | ✅ mock LLM 集成测试 |
| `src/services/impact-engine.ts` | 424 | 事件影响规则矩阵 | ✅ |
| `src/app/api/amap/route/route.ts` | ~120 | 路线代理 + 无界缓存(⚠️) | ✅ 部分边界 |

## 8. 技术债(带证据)

1. **死代码**:`src/services/ai/actions/planner.ts` 零调用方(含 40 行 prompt)。仓库自己的 `CURRENT_ARCHITECTURE.md §10` 已列为已知债。
2. **三条并行规则引擎**:mock.ts 关键词链、rule-planner.ts、agent 路由 demo regex 旁路(`route.ts:346-363`)。
3. **工具定义三处注册**:agent/tools 的工具数组(:55-78)+ executor switch(:2219-2248 区域)+ safeToolResult 序列化器——每加一个工具改 3 处,已出现 `analyze_event_impact` 与 `analyze-event-impact` 双分支。
4. **三个 Supabase 客户端工厂**:`trips/supabase.ts:23`、`knowledge/supabase.ts:17,26`、`supabase/auth.ts:15`;`isSupabaseConfigured()` 定义两次。
5. **重复 fetch+envelope 样板** 10 处(trip-commands.ts、NewTripExperience、today/page、CredentialEditor、OfferHub、LiveDiscovery、XhsGuidePanel 等);`.catch(() => toast.error(...))` 吞错误原因。
6. **cookie 解析重复**:`api-guards.ts:31-38` 与 `workspace.ts:222-229` 逐字相同。
7. **knowledge 双源**:`retriever.ts:3-59` 硬编码 5 条 BUILTIN_KNOWLEDGE 复制 knowledge/*.md 内容,必然漂移。
8. **schema 悬空**:`bookings` 表只写不读;`itinerary_items.reservation_id` 列无消费方。
9. **魔法数字**:short-link.ts:47(8s 超时/1 次重试)、fliggy-top.ts:160(15s)、llm.ts:14(默认模型 gpt-4o-mini)、温度 0.2/0.4 硬编码。
10. **文档漂移**:CURRENT_ARCHITECTURE 写 26 命令/15 agent 工具/14 MCP 工具,实际 ~46/22/22;BETA_ACCEPTANCE 引用已删除的 `api/agent/create`;TRAVEL_OS_ARCHITECTURE 整篇过期;skills/voyage/references/runtime-api.md 缺 6 条 UI-only 命令。

## 9. Bug 风险

| # | 风险 | 位置 | 严重度 |
|---|---|---|---|
| 1 | **无界缓存**:routeCache 无上限、过期条目永不驱逐(读时才判 TTL),恶意/意外坐标输入可撑爆内存 | `amap/route/route.ts:20-27` | 高 |
| 2 | **非事务 Supabase 保存**:replaceChildren 逐表 delete-then-insert,中途崩溃致子行与 payload 不一致;save() 全量覆盖 payload | `trips/supabase.ts:114-201` | 高 |
| 3 | **静默合成降级**:LLM 未配置/故障时返回 mock/规则输出(mock.ts 关键词链),fallbackReason 有标志但用户感知弱 | `ai/openai.ts:20`、`conversation-planner.ts:329-363` | 中 |
| 4 | **畸形 tool args 静默丢弃**,模型无从纠正 | `llm.ts:55-64` | 中 |
| 5 | **demo regex 旁路**:demo 模式下命中子串即绕过 LLM,语义与真实模式不一致 | `route.ts:346-363` | 中(仅 demo) |
| 6 | **MOCK_GUEST_USER**:Supabase 未配置时 getCurrentUser() 返回假用户,下游身份逻辑被蒙蔽 | `supabase/auth.ts:38-44` | 中(设计如此,需显性化) |
| 7 | 吞错:`.catch(() => toast.error("应用修改失败"))` 丢弃根因,排障困难 | `today/page.tsx:160`、`trip-commands.ts:45` | 低-中 |
| 8 | OfferHub `void fetch(...)` fire-and-forget,无清理无失败感知 | `OfferHub.tsx:196` | 低 |

## 10. 性能问题

- routeCache 无界(同 §9-1)——唯一发现的内存级风险;`api-guards.ts` 自己的桶 Map 限 1 万,这里没有。
- 其余外部调用超时覆盖完整:amap 10s、fliggy 15s、tikhub 8s+1 重试、short-link 8s、city-cover deadline 预算、LLM 60s。高德 REST 有 QPS 批控 + 并发 3 worker 池。
- LLM 调用无重试:429/5xx 直接失败(鲁棒性问题同时也是性能问题)。
- E2E workers:1 + 单 build 复用,CI 时长可控;未见性能画像数据(无 perf 基准,列 P2)。

## 11. 安全问题

**做得好的**:SSRF 防护(`lib/safe-url.ts` + 测试)、限速(滑动窗口,per-cookie,按付费后端分域)、RLS 迁移 0002 全表 owner 化(0001 的宽松策略被替换)、proposalToken 哈希存储 + 一次性 + 修订绑定、分享 token UUID 122 位熵 + 7 天过期 + toPublicTrip 白名单裁剪、无 dangerouslySetInnerHTML/eval、无硬编码密钥(.env.example 全空,local-credentials.json 未入库)、访客目录路径遍历防护。

**待修的**:
1. 分享令牌打在 debug 日志(`share/route.ts:69`)——日志系统若开 debug 级即可枚举令牌。
2. `/api/voyage/share` GET 无 enforceRateLimit(低风险:令牌熵足够,但与全线不对称)。
3. `local-credentials` 路由是密钥写入面,门禁依赖 `VOYAGE_LOCAL_SETTINGS_ENABLED` + localhost + 非 CI + 同源——纵深尚可但零路由级测试;hostname 检查作为安全边界较脆弱。
4. 限速/工作区/缓存的**单实例假设**是多实例部署下的安全回归(配额保护静默失效)。
5. x-forwarded-for 排除是有意为之(已注释),但意味着代理后限速按代理计数——文档已记录,接受。

## 12. 测试覆盖缺口

已有:67 vitest 文件/392 用例,覆盖 skill 运行时、提案令牌(并发/重放/篡改/TTL)、planning、social、brain、impact、replan、trip-state、memory、RAG、workspace 清理、api-guards;9 Playwright 规格/28 用例。

**缺口(按风险排序)**:
1. **组件层零测试**:vitest include 只有 `tests/**/*.test.ts`(vitest.config.ts:15),`@testing-library/react` 装而未用。NewTripExperience(1091 行,修订冲突重试逻辑 :757-932)、trip-store(修订锁中心)、XhsGuidePanel(548)、OfferHub(462)无一有单测。
2. **安全敏感路由零路由级测试**:/api/voyage/command、/local-credentials、/import、/share、/discover、/capabilities、amap/poi、social/*。
3. **Supabase 持久层零测试**(内存仓储有测试,真实现没有);embeddings.ts、auth.ts 同样为零。
4. **tests 不进 typecheck**:tsconfig include 只有 src/**,测试代码类型错误只能在 vitest 运行时暴露。
5. prompt 只有 1 处 snapshot(agent-tools-context),其余 4 处 prompt 裸奔。

## 13. UX 问题

(静态代码走查层面;完整走查列 P2)
- 吞错 toast:"应用修改失败,请重试"无根因、无重试动作(`today/page.tsx:160`)。
- 降级感知:LLM 故障时用户拿到规则/合成回答,fallbackReason 有数据但 UI 呈现强度未知——需要一次真实模式走查验证。
- 空状态:LiveDiscovery/XhsGuidePanel/OfferHub 有 load/empty/error 分支(静态检查),但 demo 与真实模式空状态一致性未验证。
- 665 行 demo 行程编译进生产包并被服务端导入(`agent/tools/route.ts:10`)——功能正确,包体积与心智负担是 UX-adjacent 债。

## 14. 可维护性问题

1. **runtime.ts 上帝类**:2274 行,40+ 方法,createTrip ~270 行/replanTrip ~180 行——新命令的学习曲线与合并冲突面都在变大(有 golden 测试兜底,分解可行但需专项)。
2. **新命令四连跳**:contracts input+output schema → runtime switch → command 路由限速 map → agent 白名单+safeToolResult+case → MCP 注册 → 暴露矩阵文档 → 测试。规则已写进 `RUNTIME_COMMAND_EXPOSURE.md`,但全靠人记——最值得蒸馏成 dev-skill。
3. **分层扭结**:`check-in.ts:3`(services)导入 `@/store/trip-store`(store),而 store 又导入 services——现在是延迟环,加一条导入就炸构建。
4. 12 个 >400 行文件(15 个最大文件中的 12 个);巨型函数如上。
5. 无 Prettier;eslint 仅 next 默认集,无 import 边界规则。

## 15. 可扩展性问题

- **命令可扩展性**:契约层(zod)与 envelope(`voyage.skill.v1`)设计得很好,坏在注册面分散(§14-2)。
- **provider 可扩展性**:`TravelDataProvider`/`SocialProvider`/事件 provider 接口干净,fixture 注入模式成熟——新增 provider 成本低。✅
- **持久化可扩展性**:repository 抽象存在,但 Supabase 实现非事务 + 零测试,换后端(如 SQLite/D1)要重验全部持久化语义。
- **部署可扩展性**:单实例三件套(限速/routeCache/文件工作区)把水平扩展焊死了——上 serverless/多实例前必须重构这三个点。
- **AI 可扩展性**:llm.ts 是单一 OpenAI 兼容通道,无流式、无 JSON-mode 工具 schema 约束、无多模型路由;换供应商容易,做供应商间对比 eval 难(这正是 benchmarks/ 要解决的)。

---

## 附:与本审计配套的文档

- `docs/capability-matrix.md` — 能力矩阵与评分
- `docs/autonomous-backlog.md` — Top 20 任务清单(P0→P1→P2)
- Audit V2 将在 Sprint 完成后重扫并对照本文件
