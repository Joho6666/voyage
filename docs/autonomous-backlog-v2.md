# Autonomous Backlog V2

> 日期:2026-10-05 · 基线:main@6542303(Audit V2) · V1 的 20 项全部闭环(见 `engineering-audit-v2.md`)
> 本轮新特点:P0/P1 任务大多带现成数据集与基线,修完立即可量分。

## P0

### ✅ EXTRACT-001 修复 planning 提取器 11 个 knownFailure（2026-10-05，fd32db9）
> 已完成：eval:profile 59/59 全绿（recall/precision 1.000），11 个缺陷全部修复——意图 span 守卫、目的地多触发扫描（日期连接词/活动动词跳过）、(?<!月) 天数断言、pace 步行/预算守卫、否定优先、吃素入词表、mustVisit 子句边界。
- **问题**:`benchmarks/eval/planning-profile/dataset.json` 中 11 个 `knownFailure` 案例钉住的真实缺陷:必去/避开 POI 被目的地兜底正则当 destination;"5月1日"的"1日"被读成 days=1;"不要参考社交媒体"被肯定式正则抢先(socialOptIn 反转);"吃素"不在词表;mustVisit 子句吞掉整句;"步行适中"误触发 pace=balanced。
- **方案**:逐条修 `extractPlanningProfile`(conversation-planner.ts):目的地兜底加"已识别 POI 信号词则不捕获"守卫;天数正则排除日期上下文(先行断言);否定语义统一预处理(把否定子句先剥出再跑肯定式);词表补"吃素/素食主义";mustVisit 的 extractAfter 捕获窗口缩到子句边界。**每修一个,数据集对应案例翻绿,并删除 knownFailure 标记**。
- **验收**:`npm run eval:profile` 全绿;`tests/planning/*` 不回归。**测试**:数据集即测试。

### ✅ OPT-001 修复 optimizer 聚类质量缺口（2026-10-05，d8c7e2e）
> 已完成：optimizeGuideDayAssignment 双候选取更优（聚类 vs 原始顺序分块，同一天内排程），s2d-6p-hotel 从劣化 45% 变为持平基线；bench:optimizer 5/5，knownFailure 退役。
- **问题**:`bench:optimizer` 场景 s2d-6p-hotel:地理聚类的天分配比朴素顺序差 45%(步行米数)。
- **方案**:day-assignment 评分引入 naive 分配对比(取更优者),或聚类后做一次 2-opt 交换改进;保持确定性(禁止时间/随机源)。
- **验收**:`npm run bench:optimizer` 该场景翻绿且全部场景确定性。

### ✅ AGENT-001 get_trip 新鲜度 + resyncTrip ok 检查（2026-10-05，9e87c7c）
> 已完成：get_trip 工具改为实时 runtime 读取（不再用循环前缓存的 envelope）；resyncTrip 尊重 envelope.ok（ok:false 不再覆盖本地状态），新增回归测试。
- **问题**:agent 循环里 get_trip 工具返回循环前缓存的 tripEnvelope,提案应用后第二轮的 get_trip 是旧的(评审 L6);`store/trip-store.ts` resyncTrip 忽略 envelope.ok。
- **方案**:get_trip 工具的 execute 改为实时 `ctx.runtime.execute("get-trip", …)`(ctx 已有 runtime);resyncTrip 检查 `envelope.ok` 后再 setState。
- **验收**:agent-tools-context 测试补充断言;trip-store 测试补"ok:false 不写 store"。

## P1

### CLIENT-001 迁移剩余 fetch 样板到 api-client
- **问题**:NewTripExperience、CredentialEditor、LlmProviderEditor、OfferHub、LiveDiscovery、XhsGuidePanel 仍有手写 fetch+envelope(评审确认至少 6 处)。
- **方案**:逐个换成 `postEnvelope`/`runCommand`,统一网络错误文案;行为不变。
- **验收**:grep `await fetch("/api/voyage` 在 src/components、src/features、src/app(非路由)清零。

### HTTP-STATUS-001 api-client 区分 HTTP 状态
- **问题**:postEnvelope/runCommand 忽略 `response.ok`(与旧代码一致地解析 json 失败即网络错);5xx 返回 HTML 时 `response.json()` 抛错落进"网络异常"分支,误导排障。
- **方案**:postEnvelope 先判 `response.ok`,`!ok` 时尝试解析 envelope,失败抛 `ApiError("服务异常 (500)", undefined, status)`。需要产品确认文案后实施。

### AGENT-002 demo regex 旁路退役
- **问题**:demo 模式下 `/少走|走路|…/` 命中即绕过 LLM(route.ts:203-205),行为与真实模式不一致(Audit V1 §9-5)。
- **方案**:demo 模式下也走 LLM(未配 LLM 时自然落到规则规划),删除 regex;E2E demo 断言同步调整。
- **验收**:`tests/agent-tools-context.test.ts` + Playwright conversational-planning 绿。

### KNOWLEDGE-001 双源同步 + 语料扩充
- **问题**:`retriever.ts` BUILTIN_KNOWLEDGE 硬编码 5 条与 knowledge/*.md 双源必漂移;语料只有 4 篇种子。
- **方案**:构建期(或测试)从 knowledge/*.md 生成 BUILTIN_KNOWLEDGE;语料按城市扩充(重庆/成都/西安/杭州 至少各 2 篇),跑一次真实 ingest 验证。
- **验收**:双源一致性测试;`tests/knowledge-rag.test.ts` 绿。

### TEST-005 NewTripExperience 修订冲突单测
- **问题**:1091 行核心 UI,修订冲突/重试逻辑(:757-932)只有 E2E 间接覆盖。
- **方案**:抽离冲突处理纯函数(store 动作或 hook),vitest 组件级测试渲染临界态(修订过期、重试、错误横幅)。
- **验收**:.test.tsx 直接断言冲突分支。

### CI-002 E2E 冒烟与基准本地化
- **方案**:package.json 加 `test:e2e:smoke`(golden-trip + offline-fallback);CONTRIBUTING 注明提交前跑法;bench 基线刷新命令写进 README。

## P2

- **RUNTIME-001 runtime.ts 分解**:createTrip(~270 行)/replanTrip(~180 行)抽到 planning 服务;golden + 注册表已提供安全网;做完 agent route 与 runtime 均可 <1000 行。
- **DEPLOY-001 多实例方案**:限速外置(Redis/签名配额)、工作区迁对象存储;先写决策文档。
- **UX-001 真实模式走查**:LLM 降级感知(PlanningStatusCard 已有状态面)、错误 toast 的重试动作、空态一致性。
- **PERF-001 性能画像**:build 体积(demo 行程 665 行在 server bundle)、冷启动、LLM P95。
- **STYLE-001**:Prettier + eslint import 边界规则(no-restricted-imports 禁 services→store)。
- **TS-002**:渐进启用 noUncheckedIndexedAccess(extractPlanningProfile 区域收益最大)。
- **DB-001**:bookings 表利用或删除;itinerary_items.reservation_id 列处置。
- **COOKIES-001**:cookie 值含 "=" 截断修复(评审 L5,触碰 readRequestCookie 时做)。

## 执行顺序建议

~~EXTRACT-001 → OPT-001 → AGENT-001~~（P0 已于 2026-10-05 全部完成）→ 下一批:CLIENT-001/HTTP-STATUS-001（合并一个 PR 粒度）→ AGENT-002 → TEST-005 → KNOWLEDGE-001 → CI-002 → P2 按需。
