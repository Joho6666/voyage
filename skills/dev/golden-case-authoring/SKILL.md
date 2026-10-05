---
name: golden-case-authoring
description: 为 Voyage 编写零成本、确定性 golden 案例 / benchmark 案例的方法论——fixture provider、临时工作区、断言纪律。
---

# Skill：编写 Golden / Benchmark 案例

## 适用场景

- 给新命令或引擎行为补回归案例（vitest golden 测试或 `benchmarks/cases/` 案例文件）。
- 改动规划/优化/重规划算法后，量化"变好还是变坏"。
- 为 prompt 或运行时语义变化建立可评审的 diff 基线。

## 触发条件

- 一个 bug 修好了——先写一个能抓它的 golden 案例。
- 一个行为被讨论"应该是这样"——把它固化为案例而不是口头约定。
- `npm run bench` 或 `npm run eval:profile` 报告需要扩充覆盖。

## 工作流程

1. **选载体**：
   - 命令链行为（跨命令、含确认纪律）→ `benchmarks/cases/*.bench.json` 或 `tests/golden-cases.test.ts`。
   - 单函数语义（如 `extractPlanningProfile`）→ 对应 `benchmarks/eval/<surface>/dataset.json`。
   - prompt 文本 → `tests/prompt-snapshots.test.ts` 的 golden 文件。
2. **fixture 注入**：用 `tests/fixtures/voyage-provider.json` + `VOYAGE_ALLOW_MOCK=1`（或测试里直接 `new RealFixtureProvider(fixture)`），`FakeSocialProvider` 补社交信号。**永远不依赖真实付费 API。**
3. **隔离**：每个案例用独立 `mkdtemp` 临时目录做 `VOYAGE_DATA_DIR`/workspace；测完 `rm -rf`。绝不写仓库内 `.voyage/`。
4. **断言纪律**（按此优先级选断言点）：
   - envelope 级：`ok`、`error.code`、`providerStatus`（诚实降级是否生效）。
   - 领域级：revision、proposalToken 存在性、changeSet 量化指标（步行米数、费用差）。
   - 不要断言内部私有字段或与实现细节强耦合的顺序。
5. **错误案例也要**：每个成功案例配一个 `expectError`/`rejects.toMatchObject` 的对抗兄弟（伪造令牌、过期 revision、非法输入）。
6. **命名**：`<域名>-<行为>-<变体>`，与既有 golden 案例风格一致。
7. **基线**：benchmark 案例全绿后 `npm run bench:baseline`；行为变化时先跑 `bench:compare` 再决定是否接受新基线。

## 检查清单

- [ ] 零网络、零付费调用（grep 案例文件无真实 key / 真实坐标约束）
- [ ] 临时工作区隔离，测试后清理
- [ ] 断言落在 envelope/providerStatus/量化指标层
- [ ] 有至少一个错误路径案例
- [ ] 双跑确定（benchmark runner 自带 determinism 检查）
- [ ] 基线已更新或 diff 已评审

## 输入 / 输出

- 输入：要固化的行为描述、涉及的命令链/函数。
- 输出：案例文件 + （benchmark）基线更新 + 文档行。

## 失败处理

- 案例非确定 → `npx tsx benchmarks/run.ts --debug-diff <caseId>` 找首个差异路径；通常是易变字段（时间戳/随机 id）需要归一，而不是业务真的不确定。
- fixture 数据不够 → 扩展 fixture JSON 而不是在案例里硬编码坐标——保持案例与数据分离。
- `NO_PROVIDER_CONFIGURED` → 忘了 `VOYAGE_ALLOW_MOCK=1` 或 fixture 路径。

## 最佳实践

- 一个案例只讲一个行为故事；组合行为拆成多步链。
- providerStatus 是 Voyage 的产品承诺——案例要固定"估算不冒充真实"。
- 把发现的实现 bug 标记为 `knownFailure` 留在数据集里（修好即翻绿），不要删案例粉饰基线。

## 反模式

- 用真实 AMap/LLM key 跑"先看看结果"。
- 断言 JSON 全量深比较（任何无害变化都会打绿为红）。
- 删掉失败案例让套件通过。
- 在案例内复制 665 行 demo 行程而不是引用 `@/data/demo/chongqing` 或 fixture。

## 示例

- 命令链：`benchmarks/cases/golden.bench.json` 的 `golden-propose-apply-token-chain`。
- 对抗案例：`benchmarks/cases/adversarial.bench.json` 的 `adversarial-forged-token`。
- 字段级数据集：`benchmarks/eval/planning-profile/dataset.json`（含 `knownFailure` 用法）。
- 运行时级 golden：`tests/golden/phase6-cases.test.ts`。
