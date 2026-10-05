# Voyage 工程审计 V2(Audit V2)

> 日期:2026-10-05 · 范围:main@8cb13ad(Audit V1 基线)→ main@6542303,共 20 个 commit
> 方法:对照 `engineering-audit.md` V1 全量复核 + 本轮评审(四角色)发现闭环

## 一、总览

| 指标 | V1 | V2 | 变化 |
|---|---|---|---|
| vitest 用例 | 392 | **461** | +69 |
| 测试文件 | 67 | **78** | +11 |
| tests 进 typecheck | ❌ | ✅(typecheck:test 进 CI) | |
| 组件测试 | 0 | 2 套件 8 用例(jest-dom 基建) | |
| benchmarks/evals | 无 | 15 案例基准 + 3 套 eval/基准 runner | |
| prompt snapshot | 1 处部分断言 | 4 个 golden 文件全量钉住 | |
| dev-skills | 0 | 2(add-runtime-command / golden-case-authoring) | |
| agent route 行数 | 530(三处注册) | 324 + registry 446(单一来源) | |

## 二、V1 问题闭环(全部有 commit 佐证)

**P0(8/8 完成)**
1. ✅ routeCache 无界内存 → BoundedTtlCache + 不再缓存估算兜底(700b209)
2. ✅ 分享令牌日志泄漏 → 前缀脱敏(72fc73f)
3. ✅ local-credentials 路由零测试 → 门禁矩阵 10 用例 + 文件存储 7 用例(27584be)
4. ✅ command/import/share 零测试 → 12 路由级用例(e320c71)
5. ✅ 测试不入 typecheck / vitest 排除 .tsx → tsconfig.test.json + 种子组件测试;连带修复 ~50 个存量 fixture 类型漂移(76aaf9a)
6. ✅ 死代码 planner.ts → 删除 + 债单核销(49a18be)
7. ✅ services→store 分层倒置 → check-in 迁至 features/today(5ac74dd)
8. ✅ Supabase 持久层零测试 → mock 契约 7 用例 + 非事务窗口文档化(f32fcff)

**P1(11/11 完成)**
9. ✅ benchmarks/ 基座(golden/edge/adversarial 15 案例,确定性双跑,零成本)(88c0707)
10. ✅ planning-profile eval:59 案例,48 活跃全绿 + **11 个如实记录的提取器缺陷**(7a2cb60)
11. ✅ NLU→executor→diff 全链 eval:23 案例(7dfb56e)
12. ✅ optimizer 质量基准:**抓到真实质量缺口**(s2d-6p-hotel 场景聚类劣于朴素顺序 45%,记 knownFailure)(7dfb56e)
13. ✅ 5 处 prompt snapshot 全覆盖(c3902be)
14. ✅ dev-skill×2(452231a)
15. ✅ 类型化 api client + trip-store 修订纪律测试(6ada5c7)
16. ✅ llm.ts 退避重试 + 畸形 tool args 回传模型自纠 + LLM_TIMEOUT_MS(0baa758)
17. ✅ 文档真相:计数校准(46/22/22)、过期文档归档、runtime-api 补 8 条 UI 命令(f2de5eb)
18. ✅ CI:coverage + benchmarks job + typecheck:test(8902bef)
19. ✅ 工具注册单一来源 + Supabase/cookie 去重(6542303 / 1f77872)

**计划外新发现并已修**
- 两个 service 文件违反"禁用 server-only"约束(按 logger.ts 记录的架构意图修复)(7a2cb60)
- 四角色评审 4 项 HIGH/MED:agent 循环 OpenAI 协议违规消息序列、CI 假比较、Retry-After 无上限、/v1 路径拼接丢段(e8329d2)
- importRouteToTrip 的 importedCount 回归(评审 L1)(5b897f4)

## 三、仍然存在的问题(按风险排序 → Backlog V2)

1. **单实例设计三件套**:限速与 routeCache 已有界,但访客工作区/限速仍是单实例假设——多实例部署前必须外置。文档已声明,代码未动。
2. **Supabase 非事务保存**:契约测试钉住了失败语义,但一致性问题本身仍在(需服务端事务或 outbox)。
3. **planning 提取器 11 个已知缺陷**(eval 数据集内含 knownFailure 标记):POI 污染目的地、日期"1日"误读天数、"不要参考社交媒体"否定吞没、"吃素"词表缺失、mustVisit 吞句、"步行适中"泄漏 pace。修一个翻绿一个。
4. **optimizer 聚类质量缺口**:s2d-6p-hotel 场景比朴素顺序差 45%(bench:optimizer knownFailure)。
5. **demo regex 旁路**仍在(agent 路由:204);get_trip 结果在多轮循环中可能过期(评审 L6);resyncTrip 忽略 envelope.ok(评审 nit)。
6. **api-client 覆盖不全**:NewTripExperience/CredentialEditor/OfferHub/LiveDiscovery/XhsGuidePanel 仍有手写 fetch 样板;postEnvelope 与 runCommand 忽略 HTTP 状态码(与旧代码保持一致,改它需要产品决策:5xx 与网络错如何区分提示)。
7. **runtime.ts 上帝类**(2274 行)未分解——本 sprint 优先给了注册表(风险更高收益更直接);golden 测试网已就绪。
8. **VOLATILE_KEYS 全局剥离**会掩盖"键被删除"类回归(L4,已记录);cookie 值含"="截断(L5,触碰时顺手修)。
9. **knowledge 双源**(BUILTIN_KNOWLEDGE vs knowledge/*.md)与语料规模(4 篇)未动。
10. **多实例/性能画像/Prettier/eslint import 边界** 全部未动(P3)。

## 四、新瓶颈(Audit V2 新暴露)

- **组件层仍薄**:2 个种子套件证明了可行性,但 NewTripExperience(1091 行,修订冲突重试)与 XhsGuidePanel 等核心 UI 仍无单测——E2E 是唯一防线。
- **benchmark 断言粒度有限**:digest 机制(M1)已捕获内容漂移,但"变好还是变坏"的语义判断仍需人读 diff;长时间看应把 metrics 断言(步行米数、费用)写进更多案例。
- **E2E 在 CI 之外 rarely run**:本地基线不包含 Playwright;建议本地至少保留 `test:e2e --grep golden`。

## 五、结论

V1 的判断(完成度 85%、不是 Demo)经冲刺验证成立。本轮把 P0/P1 全部闭环,并把"资产化"落地为可复跑、可对比、可交接的机制(benchmarks/evals/skills/golden prompts/CI)。项目从"能跑且测试多"升级为"行为有基线、Prompt 有快照、安全面有门禁矩阵、加命令有检查单"。下一轮最高杠杆:修 planning 提取器 11 个 knownFailure + optimizer 聚类缺口(都有现成数据集直接量分)。
