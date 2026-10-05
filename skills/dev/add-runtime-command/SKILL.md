---
name: add-runtime-command
description: 在 Voyage 运行时中新增一个命令的完整流程——从 zod 契约到四个适配器与测试的无遗漏检查单。
---

# Skill：给 VoyageSkillRuntime 新增命令

## 适用场景

- 需要给运行时增加一个新能力（查询、变更、提案类命令）。
- 审查一个"命令加了但某个适配器没跟上"的 PR。
- 排查"新命令在 Web 能用、在 MCP/CLI 里看不见"这类漂移问题。

## 触发条件

- 有人说"给 Voyage 加一个 xxx 命令 / 工具"。
- `RUNTIME_COMMAND_EXPOSURE.md` 的矩阵需要新增一行。
- 新增 `commandSchemas` 键。

## 工作流程（按顺序执行，不可跳步）

1. **契约**：`src/skill/contracts.ts` —— 在 `commandSchemas` 加 input zod schema，在 `outputSchemas` 加 output schema。命名用 kebab-case 动词短语（`replan-trip` 风格）。
2. **运行时**：`src/skill/runtime.ts` —— 新增私有方法 + `execute()` switch 分支，方法内解析 input、执行领域逻辑、返回 `successEnvelope(data, providerStatus?, warnings?)`。适配器永远不复制业务逻辑。
3. **错误**：失败抛 `SkillError(code, message)`，code 必须已在 `src/skill/errors.ts` 的 `SkillErrorCode` 联合类型中；需要新 code 就先加类型。
4. **Web 命令路由限速**：`src/app/api/voyage/command/route.ts` 的 `COMMAND_RATE_SCOPES` 里声明该命令的限速域（写命令 → `write`；碰付费后端 → 对应域；纯读可不限）。漏掉 = 命令可被网络速度打爆。
5. **MCP（可选）**：`packages/voyage-mcp/server.ts` 按 1:1 注册 `voyage_*` 工具；写工具必须带 `readOnlyHint`/`destructiveHint` 注解；凭证依赖重的用 `VOYAGE_ENABLE_*` 环境变量门控。更新 `docs/RUNTIME_COMMAND_EXPOSURE.md` 矩阵行。
6. **Web Agent（可选）**：`src/app/api/agent/tools/route.ts` 白名单 + `safeToolResult` 序列化分支 + 提示词工具要点行。LLM 侧永不注册能自毁的命令（`apply_change` 被硬性禁止是先例）。
7. **测试**：`tests/skill/` 下加按命令命名的测试文件，覆盖成功路径 + `SkillError` 路径 + 修订锁/确认纪律（如适用）。
8. **文档**：`docs/RUNTIME_COMMAND_EXPOSURE.md` 加一行；若改变架构事实，同步 `docs/CURRENT_ARCHITECTURE.md` 的计数。

## 检查清单

- [ ] `commandSchemas` + `outputSchemas` 双契约齐全
- [ ] `execute()` switch 有分支（注意历史上有过 `analyze_event_impact` 与 `analyze-event-impact` 双分支教训——命名与既有命令风格逐字一致）
- [ ] 错误码在 `SkillErrorCode` 联合类型内
- [ ] `COMMAND_RATE_SCOPES` 已声明（或注明为何不限速）
- [ ] MCP 注册（如对外）+ 注解 + 门控 + 暴露矩阵行
- [ ] Agent 白名单 + `safeToolResult` + 提示词要点（如对 LLM 开放）
- [ ] `tests/skill/` 新测试：成功、失败、并发/修订边界
- [ ] `npm run typecheck && npm run test && npm run bench` 全绿

## 输入 / 输出

- 输入：命令名、语义、input/output 形状、限速域、目标适配器集合。
- 输出：可被 4 个适配器一致调用的命令 + 测试 + 文档行。

## 失败处理

- 适配器报 `UNKNOWN Voyage command` → 契约键与路由 switch 拼写不一致。
- MCP 测试报 zod raw shape 错误 → `inputShape` 需要真正的 zod schema（参考 `voyage-mcp.test.ts`）。
- 基准回归（`npm run bench:compare` 出现 FAIL）→ 命令改动了共享路径，先看断言的 providerStatus 与错误码。

## 最佳实践

- 复用既有领域服务；运行时方法只做编排与契约校验。
- 写命令走"提案 → Diff → proposalToken → apply"纪律，除非是纯 UI 标量更新。
- 保持 envelope `voyage.skill.v1` 兼容——不要破坏 `ok/data/error/warnings/generatedAt/providerStatus` 形状。

## 反模式

- 在适配器（路由/MCP/CLI）里写 if-else 业务分支。
- 给 LLM 开放自应用型命令。
- 忘记限速域。
- 新命令不带测试就合并。

## 示例

- 读取类最小样例：`get-trip`（契约 → switch → 路由 → 测试，无 MCP）。
- 提案类完整样例：`propose-change` → `apply-change`（令牌、修订锁、四适配器）。
- 参考测试：`tests/skill/runtime-commands.test.ts`、`tests/skill/proposal-token.test.ts`。
