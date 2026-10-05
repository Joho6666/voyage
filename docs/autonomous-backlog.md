# Autonomous Backlog V1

> 日期:2026-10-05 · 基线:main@8cb13ad · 来源:`engineering-audit.md` + `capability-matrix.md`
> 执行纪律:每任务独立 commit;lint/typecheck/test/build 全绿才算完成;禁止删测试换通过;benchmark/eval 全部走 fixture,零付费 API。

## P0

### FIX-001 routeCache 有界化
- **问题**:`src/app/api/amap/route/route.ts:20` 的 `routeCache` 是无上限 Map,过期条目仅在读时跳过、永不删除;坐标键可被脚本刷出无限条目 → 内存增长不可控。
- **原因**:与 `api-guards.ts`(限 1 万桶)不同,这里实现时没加容量上限。
- **方案**:抽成有界 LRU(容量上限 + 过期驱逐 + 写时清理),手写 ~40 行,不引依赖;容量用常量并注释。
- **涉及文件**:`src/app/api/amap/route/route.ts`(或抽到 `src/lib/lru-cache.ts`)、新增测试。
- **依赖**:无。**风险**:低(纯函数级改动)。
- **验收**:压力测试写入 > 容量条目后 size 恒 ≤ 上限;过期条目被驱逐;命中行为不变。**测试**:单测含边界(容量 1、TTL 过期、重复键覆盖)。

### FIX-002 分享令牌日志脱敏
- **问题**:`src/app/api/voyage/share/route.ts:69` 将分享 token 打入 debug 日志,日志开 debug 即可枚举分享链接。
- **方案**:日志只记 token 长度/前 4 位脱敏形式。**涉及文件**:share/route.ts。**依赖**:无。**风险**:低。
- **验收**:grep 无明文 token 落日志;分享功能 E2E 仍过。**测试**:现有 E2E + 代码审查。

### TEST-001 local-credentials 路由测试
- **问题**:密钥写入面 `/api/voyage/local-credentials` 零路由级测试;门禁矩阵(VOYAGE_LOCAL_SETTINGS_ENABLED/localhost/CI/同源)无回归保护。
- **方案**:路由集成测试:非 localhost 403、门禁关闭 403、CI 环境 403、合法请求读写成功、敏感键回读脱敏(验证实际行为)。
- **涉及文件**:`tests/local-credentials-route.test.ts`(新)。**依赖**:无。**风险**:低。
- **验收**:门禁矩阵 4 分支全覆盖且断言真实响应码。**测试**:即本测试。

### TEST-002 command/import/share 路由测试
- **问题**:所有变更命令入口 `/api/voyage/command`、授权导入 `/api/voyage/import`、分享 `/api/voyage/share` 无路由级测试;现仅 E2E demo 快乐路径。
- **方案**:集成测试(真实 runtime + 临时工作区):command 非法命令 400、限流触发 429、正常往返 envelope 形状;import 未授权 tripId 拒绝;share 创建/过期/白名单裁剪。
- **涉及文件**:`tests/voyage-command-route.test.ts` 等(新)。**依赖**:无。**风险**:低。
- **验收**:authz/限流/错误码三轴覆盖。**测试**:即本测试。

### TOOL-001 测试纳入 typecheck + 组件测试基建
- **问题**:tsconfig 只含 src/**,tests 类型错误仅运行时暴露;vitest include 排除 `.tsx`,`@testing-library/react` 装而未用,组件测试基建失效。
- **方案**:新建 `tsconfig.test.json`(或 tsconfig 增 include tests + 独立 noEmit 配置)并加 `npm run typecheck:test` 进 CI;vitest include 增加 `tests/**/*.test.tsx`;写 2-3 个种子组件/store 测试(优先 trip-store 修订锁行为)。
- **涉及文件**:tsconfig.json、package.json、vitest.config.ts、.github/workflows/ci.yml、新测试。**依赖**:无。**风险**:低-中(可能暴露存量类型错误,逐一修复而非跳过)。
- **验收**:`typecheck:test` 在 CI 绿;.tsx 测试能跑;存量错误清零。**测试**:新增种子测试即验证。

### FIX-003 移除死代码 planner.ts
- **问题**:`src/services/ai/actions/planner.ts` 零调用方(含 40 行 prompt),隐性腐烂;CURRENT_ARCHITECTURE §10 已列为已知债。
- **方案**:执行时先 grep 复核零调用(含 tests/packages/docs),然后删除,并在 CURRENT_ARCHITECTURE 已知债清单划掉该项。
- **涉及文件**:planner.ts(删)、docs/CURRENT_ARCHITECTURE.md。**依赖**:无。**风险**:低(git 可回滚)。
- **验收**:全仓 grep 零引用;typecheck/test/build 绿。

### FIX-004 check-in.ts 分层修正
- **问题**:`src/services/check-in.ts:3` 导入 `@/store/trip-store`,而 store 层导入 services 层——延迟循环依赖。
- **方案**:依赖倒置:check-in 所需的操作由调用方(store/组件)注入,或 check-in 移到 store 侧/改为接收 trip 快照的纯函数;以最小改动为准,禁止大搬家。
- **涉及文件**:src/services/check-in.ts、调用方。**依赖**:无。**风险**:低-中。
- **验收**:services/ 目录 grep 无 `@/store` 导入;行为不变(现有相关测试过)。

### TEST-003 Supabase 持久层契约测试
- **问题**:`src/services/trips/supabase.ts` 零测试;replaceChildren 非事务 delete-then-insert 的失败语义无文档无保护。
- **方案**:mock supabase-js 客户端,契约测试:save 全量覆盖语义、load 缺表容错、delete 级联顺序、失败时不再破坏 payload;在代码注释与 CURRENT_ARCHITECTURE 标注非事务 caveat 与崩溃窗口。
- **涉及文件**:tests/supabase-persistence.test.ts(新)、trips/supabase.ts(仅注释)。**依赖**:无。**风险**:低。
- **验收**:mock 契约测试绿;caveat 文档化。

## P1

### BENCH-001 benchmarks/ 基座
- **问题**:换模型/改 prompt/改策略后无法量化"变好还是变差";golden 测试散在 tests/ 各处,无统一 case 格式与对比基线。
- **方案**:`benchmarks/cases/*.json`(输入命令链 + 期望 + 评分 rubric)、`benchmarks/run.ts`(复用 runtime + `tests/fixtures/voyage-provider.json` fixture provider + 临时 VOYAGE_DATA_DIR)、指标:行程指标 diff(步行米数/天数密度)、确定性(同输入双跑一致)、providerStatus 诚实性、确定性路径延迟;`benchmarks/results/baseline.json` + 对比脚本;案例分 golden/edge/adversarial。
- **涉及文件**:benchmarks/ 全新 + package.json script。**依赖**:无(复用现有 fixture)。**风险**:中(运行器设计需评审,见 Step 4)。
- **验收**:`npm run bench` 零外部调用产出报告;基线对比 diff 可读。**测试**:runner 自身用例。

### EVAL-001 planning profile 数据集
- **问题**:`extractPlanningProfile`(conversation-planner.ts:143-238)是纯函数,承载对话创建的关键语义,但无数据集评估,改正则无从回归。
- **方案**:80+ 中文旅游话语案例(日期/中文数字预算/人数/mustVisit/avoid/pace/socialOptIn/边界与对抗输入),字段级评分(精确匹配 + 部分分),输出报告。
- **涉及文件**:benchmarks/eval/planning-profile/(cases + runner)。**依赖**:BENCH-001 的运行器。**风险**:低。
- **验收**:当前实现跑分报告落 baseline;字段准确率可见。

### EVAL-002 规则 NLU→executor→diff 链路 eval
- **问题**:指令→动作→Diff 全链路(`rule-planner.ts` + `executor.ts` + `ai/diff.ts`)纯函数可测,但无量化评估;demo regex 旁路语义未校准。
- **方案**:40+ 案例覆盖 24 种 TravelAction 中的高频子集 + 期望 TripChangeSet 关键字段(量化指标)。
- **依赖**:BENCH-001。**风险**:低。**验收**:报告落 baseline,失败案例逐条可读。

### BENCH-002 optimizer 质量基准
- **问题**:行程优化器确定性成立(CHANGELOG 声明),但各策略/参数下的质量(总步行、天数密度、餐锚点)无横向数字。
- **方案**:用 fixture POI 集跑各策略,记录指标并落 baseline;改调度算法后有回归护栏。
- **依赖**:BENCH-001。**风险**:低。**验收**:指标表落盘,双跑零漂移。

### PROMPT-001 prompt snapshot 全覆盖
- **问题**:5 处 prompt 全是内联字符串,仅 agent 系统提示词有内容断言;prompt 回归不可见。
- **方案**:扩展 agent-tools-context 测试模式到 conversation-planner/outline-planner/guide-extract/memory 披露行;golden prompt 文件(规范化空白)作为快照。
- **涉及文件**:tests/prompt-snapshots.test.ts(新)。**依赖**:无。**风险**:低。
- **验收**:5 处 prompt 内容变化会被测试捕获;快照文件可 diff 评审。

### SKILL-001 dev-skill「add-runtime-command」
- **问题**:新增 runtime 命令需改 4-7 处(见 RUNTIME_COMMAND_EXPOSURE.md 三规则),全靠人记,遗漏即漂移。
- **方案**:蒸馏 dev-skill 到 `skills/`(目录与 voyage 技能并列):适用场景/触发条件/工作流/检查单(7 步)/输入输出/失败处理/最佳实践/反模式/示例;含一个可跑的参考实现样例。
- **依赖**:无。**风险**:低。**验收**:按检查单走一遍真实命令(如注册一个只读测试命令)零遗漏;文件含全部 9 要素。

### SKILL-002 dev-skill「golden-case-authoring」
- **问题**:fixture provider + 临时工作区 + 命令链断言的模式在 18+ 个测试文件重复实现,方法论未沉淀。
- **方案**:dev-skill:何时写 golden case、fixture provider 用法、临时 VOYAGE_DATA_DIR 模式、断言什么(providerStatus/令牌纪律/修订锁)、命名与落位、反模式(断言内部字段过深)。
- **依赖**:BENCH-001(引用其 runner 模式)。**风险**:低。**验收**:含可复制模板与检查单。

### TEST-004 统一 api client + trip-store 测试
- **问题**:10 处重复 fetch+envelope 样板;`.catch(() => toast.error(...))` 吞错;trip-store(修订锁/撤销)零测试。
- **方案**:`src/lib/api-client.ts` 类型化 wrapper(envelope 解析/错误原因保留/超时);迁移高价值调用点(trip-commands.ts 全部 + today/page 吞错点);为 trip-store 写行为测试(修订冲突/重试/撤销)。
- **依赖**:无。**风险**:中(客户端行为,靠现有测试+E2E 兜底)。
- **验收**:样板点减少 ≥6 处;吞错点保留根因;trip-store 测试绿。

### ROBUST-001 llm.ts 鲁棒性
- **问题**:无 429/5xx 退避重试;畸形 tool args 静默丢弃(llm.ts:55-64),模型无从纠错;超时/模型名硬编码。
- **方案**:指数退避重试(429/5xx/网络错,2 次上限,尊重 Retry-After);畸形 args 改为把解析错误作为 tool 消息回传;`LLM_TIMEOUT_MS` 环境变量;默认模型常量集中。
- **依赖**:无。**风险**:中(测试全 mock,无真实调用)。**验收**:mock 429 触发退避;畸形 args 出现在 tool 消息;现有 agent 测试全绿。

### DOCS-001 文档真相大扫除
- **问题**:CURRENT_ARCHITECTURE 计数漂移(26→46 命令、15→22 agent 工具、14→22 MCP);BETA_ACCEPTANCE 引用已删文件;TRAVEL_OS_ARCHITECTURE 整篇过期;runtime-api.md 缺 6 条 UI-only 命令。
- **方案**:以代码为准修正计数;过期文档移入 docs/archive/ 加头部声明;补齐 runtime-api.md 命令表;capability-matrix/audit 建立互链。
- **依赖**:无。**风险**:低。**验收**:文档中每个数字可 grep 到代码证据;断链清零。

### CI-001 CI 强化
- **问题**:CI 无覆盖率报告、无 typecheck:test、无 benchmark 回归 job。
- **方案**:vitest coverage(v8,text+json 摘要上传 artifact);typecheck:test 步骤;benchmark job 跑 `npm run bench` 并在 PR 注释摘要(确定性,零密钥)。
- **依赖**:TOOL-001、BENCH-001。**风险**:低。**验收**:CI 全绿且三步均生效。

### REFACTOR-001 工具注册单一来源 + 工厂统一
- **问题**:agent/tools 工具三处注册(含双分支);3 个 Supabase 客户端工厂;2 处重复 isSupabaseConfigured;2 处重复 cookie 解析。
- **方案**:agent/tools 内聚一个 `TOOL_REGISTRY`(name/schema/execute/summarize/serialize 单一来源,循环与 safeToolResult 自动生成);`src/lib/supabase-client.ts` 统一工厂;cookie 解析并入 lib。已有测试兜底。
- **依赖**:无。**风险**:中(Agent 路由核心,多角色评审,见 Step 4)。**验收**:新增工具只改 1 处;全部现有测试绿;行为零变化。

## P2(Backlog V2 候选,r本轮不承诺)

runtime.ts 分解(createTrip/replanTrip 抽服务)· 缓存全面审计(其余 Map 类)· 真实模式 UX 走查(LLM 降级感知)· knowledge 语料扩充与双源同步测试 · 性能画像(build 体积/启动) · 多实例部署方案(限速外置/共享缓存/对象存储工作区) · Prettier + import 边界规则 · noUncheckedIndexedAccess 渐进启用 · 抖音上游恢复观察 · bookings 表利用或移除。

## 执行顺序建议

P0 按编号顺序(依赖少,可连续 commit)→ BENCH-001 先行(其余 eval/skill 引用其 runner)→ EVAL/BENCH/PROMPT/SKILL 并行推进 → TEST-004/ROBUST-001 → DOCS/CI/REFACTOR 收尾 → Audit V2。
