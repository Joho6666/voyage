# Voyage Benchmarks

确定性、零成本的行为基准。案例对真实 `VoyageSkillRuntime` 执行多步命令链,用 fixture provider
(`tests/fixtures/voyage-provider.json`)替代付费后端——**跑基准不产生任何外部 API 调用**。

## 运行

```bash
npm run bench           # 跑全部案例,写 benchmarks/results/latest.json
npm run bench:compare   # latest.json 对比 results/baseline.json,有回归则退出码 1
npm run bench:baseline  # 把 latest.json 提升为 baseline(有失败时拒绝)
```

## 案例格式

`benchmarks/cases/*.bench.json`,每个文件是 `{ "cases": [...] }`:

```jsonc
{
  "id": "golden-propose-apply-token-chain",   // 唯一、稳定
  "category": "golden",                        // golden | edge | adversarial
  "description": "……",
  "steps": [
    { "command": "create-trip", "input": { "...": "..." } },
    {
      "command": "apply-change",
      "input": { "tripId": "{{steps.0.data.tripId}}", "proposalId": "{{steps.1.data.proposalId}}" },
      "assert": [ { "path": "data.revision", "op": "equals", "value": 2 } ],
      "expectError": "CONFIRMATION_REQUIRED"   // 与 assert 二选一;失败时的期望错误码
    }
  ]
}
```

- `{{steps.<i>.<path>}}` 引用第 i 步的 envelope(整值或字符串内插)。
- 断言算子:`equals` `exists` `absent` `lengthEquals` `gte` `lte` `contains`。
- 运行时错误码归一:zod 校验失败 → `INVALID_INPUT`,其余为 `SkillError.code`。

## 判定维度

每个案例三个维度,全部落盘到 results:

| 维度 | 含义 |
|---|---|
| ok | 所有断言/期望错误码符合 |
| deterministic | 同案例跑两遍,归一化后输出逐字节一致 |
| ms | 两遍平均耗时(确定性路径的相对延迟信号) |

归一化规则:剔除易变键(`generatedAt`/`proposalToken`/`proposalId`/时间戳类);UUID 子串替换为
`<uuid>`;id 形态键(`id`/`tripId`/`fromItemId`…)中 8 位随机后缀替换为 `<rand>`;以生成 id 为键的
map,键同样归一。若误报非确定,用 `npx tsx benchmarks/run.ts --debug-diff <caseId>` 打印首个差异路径。

## 案例分类

- **golden**:核心产品承诺(创建、提案-令牌-应用、优化、状态面、fixture 检索)。
- **edge**:边界与异常输入(空 id、缺失行程、规模上限、天数溢出)。
- **adversarial**:安全纪律(未确认应用、令牌重放、过期 revision、伪造令牌)。

## 何时更新 baseline

改了运行时行为且**确认是期望中的变化**后:跑 `npm run bench` → 全绿 → `npm run bench:baseline`。
baseline 的 diff 就是"这次改动让产品变好还是变坏"的第一信号;更深的正确性由 tests/ 承担。
