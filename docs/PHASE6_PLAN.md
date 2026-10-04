# Voyage Phase 6 — Live Travel Copilot / Trip State Engine 实施计划

> 2026-10-03 立项 · 基于 docs/CURRENT_ARCHITECTURE.md 审计基线
> 原则：复用现有 Runtime，不建第二套；事实来自 Provider；AI 修改必经 Proposal→Diff→proposalToken→Apply。

## 0. 实施状态（2026-10-03 更新）

| 阶段 | 状态 | commit |
|---|---|---|
| 0a Phase 4.1 brain | ✅ 完成 | 45668f0 |
| 0b 分支收敛（7 分支归档/删除，merge open-source-readiness） | ✅ 完成 | 2f37067, 9e915b4 |
| 0c 审计文档（本文 + CURRENT_ARCHITECTURE.md） | ✅ 完成 | be705b5 |
| 6.1 Reservation domain（5 命令 + 3 MCP 工具） | ✅ 完成 | 8a25141, c8003ff |
| 6.2 Constraint engine（预订硬约束 + trip/day/candidate 评估 + get-constraints） | ✅ 完成 | 823e09d |
| 6.3 TravelEvent model（record/get-active-events） | ✅ 完成 | 9b39358, 5552789, b0017ab |
| 6.4 TripState engine（get-trip-state + MCP + perf 断言） | ✅ 完成 | ef80297, bdeae37 |
| 6.5 Impact engine（analyze-event-impact + MCP） | ✅ 完成 | 62c9f22 |
| 6.6 Event replan（propose-event-replan + 6 agent 工具 + prompt 决策序） | ✅ 完成 | 3c69763, aaaa868 |
| 6.7 Today execution console（TripStateConsole + 主动卡片） | ✅ 完成 | c3fa14d |
| 6.8 Event providers（Weather/Flight 接口 + Mock + simulate 命令） | ✅ 完成 | adb1066, 42b057b |
| 6.9 Traveler memory v1（4 命令 + 披露语 + agent prompt 接入） | ✅ 完成 | bdb4d7d |
| 6.10 golden 用例（Case 1/4/6/14 整合 + 其余索引）+ 文档收尾 | ✅ 完成 | 69f8c77 |
| 6.11 build + Playwright 终验 | ✅ 完成（build 通过，E2E 28/28） | 2b5e2f7 后 |

测试规模：67 文件 / 392 用例全绿；typecheck + eslint 零错误。runtime 命令 46 个；MCP 工具 22 个；agent 工具 22 个。

Phase 6 之后的建议（不在本次范围）：FlightAware 等真实航班 Provider 接入（接口已就绪）、Webhook 事件入口、reservations/events 独立表（当前为 payload jsonb，零迁移）、跨 trip 事件聚合分析。

## 1. 目标

把 Voyage 从「生成与修改旅行计划」升级为「持续理解旅行状态、感知现实变化、判断影响、主动提出重规划、经确认后安全更新」的 AI Travel OS。核心新域：

```
TravelEvent（现实变化）→ TripState（当前状态）→ Impact Engine（影响）→ Constraint Engine（约束）
→ Itinerary Optimizer（重排）→ Replan Candidate → TripChangeSet → Proposal → Diff → proposalToken → 用户 Apply
```

## 2. 现状问题（Phase 6 针对性解决）

1. 无 Reservation 域：航班/酒店/高铁只是普通 item，Optimizer 可随意移动。
2. 无约束引擎的 trip 级 API：Phase 4.1 constraints.ts 只作用于 outline 生成门控。
3. 无事件模型：Provider 响应直接进展示层，没有 Normalize→Event→影响分析链。
4. 无 TripState：Today 建议是 7 条静态规则，无时间/进度/延误感知。
5. 无 Impact/Replan 链路：现实变化后用户只能自然语言重新描述。
6. Planner/Replan 主路径仍是关键词规则（LLM planner 死代码）。

## 3. 与既有架构的三处适配（替代提示词的机械设计）

| 提示词设想 | 适配后的设计 | 理由 |
|---|---|---|
| 新建 TripConstraintEngine | **演进** src/services/brain/constraints.ts：新增 evaluateTripConstraints / evaluateDayConstraints / evaluateCandidateMove + reservation→HARD 约束映射 | Phase 4.1 已有硬/软约束+修复+评分，避免双引擎 |
| Itinerary Optimizer | 消费 open-source-readiness 合并来的 src/services/itinerary-optimizer/*（cluster/schedule/time-windows/validate） | 已存在且带 MCP 工具 |
| Reservation/Event 独立表 | resibirations/travelEvents 作为 Trip 一等 optional 字段（payload jsonb）+ 后续按需 0007 migration | `itinerary_items.reservation_id` 已预留；零迁移起步，跨 trip 查询再升级 |

## 4. Domain Models（新增 schema）

**Reservation**（src/schemas/reservation.ts）：id/tripId/type(flight|train|hotel|restaurant|attraction|activity|car|transfer|other)/status(tentative|confirmed|cancelled|completed)/startAt/endAt/origin/destination/location/provider/confirmationCode/price/currency/cancellationPolicy/source/sourceRef/flexibility(fixed|semiFlexible|flexible)/provenance/fetchedAt/notes/metadata。
**TravelEvent**（src/schemas/travel-event.ts）：id/tripId/type(15 种：WEATHER_CHANGED/HEAVY_RAIN/EXTREME_HEAT/FLIGHT_DELAYED/FLIGHT_CANCELLED/TRAIN_DELAYED/ROAD_CONGESTED/ROUTE_CLOSED/POI_CLOSED/OPENING_HOURS_CHANGED/RESERVATION_CHANGED/RESERVATION_CANCELLED/USER_LATE/USER_AHEAD/WALKING_OVERLOAD/BUDGET_THRESHOLD/TRIP_CONSTRAINT_VIOLATED)/severity(info|warning|critical)/occurredAt/effectiveFrom/effectiveUntil/source/sourceRef/provenance/confidence/payload/relatedEntities/acknowledgedAt。
**TripState**（src/services/trip-state/engine.ts 返回值，schema 在 src/schemas/trip-state.ts）：currentTime/currentDay/currentItem/nextItem/completedItems/remainingItems/activeReservations/upcomingHardConstraints/currentWeather/activeEvents/lateByMinutes/aheadByMinutes/remainingWalking/remainingTravelTime/estimatedFinishTime/budgetState/riskLevel/constraintViolations/suggestedActions/stale 标记。
**ImpactResult**（src/services/impact-engine.ts）：event/affectedEntities/constraintViolations/atRiskItems/impossibleItems/recoverableItems/timeDelta/budgetDelta/walkingDelta/recommendedStrategy/severity/options[]。
**TripConstraint**：由 confirmed Reservation 派生 HARD（flightDeparture/trainDeparture/hotelCheckinWindow/ticketEntryTime/reservationTime）+ profile 派生 SOFT（walking/mealTime/wake/pace/indoor/nightView/elderly/budgetTarget/transportPreference）。未知数据 → unresolvedConstraints，绝不假设。

## 5. Runtime 命令（全部走 execute() + contracts，零安全链改动）

新增：`add-reservation` `update-reservation` `remove-reservation` `get-reservations` `import-reservation` `record-travel-event` `get-active-events` `get-trip-state` `analyze-event-impact` `propose-event-replan` `get-constraints` `simulate-travel-event`(仅 DEMO/dev) `get-traveler-memory` `update-traveler-memory` `delete-traveler-memory` `disable-traveler-memory`
不变量：所有写命令 revision-locked；`propose-event-replan` 只产 Proposal（沿用 proposalToken/TTL/Diff）；confirmed reservations、done items、current item 在任何 replan 中被保留。

## 6. MCP 工具（READ 全部 readOnlyHint，apply 永远 DESTRUCTIVE）

voyage_get_reservations / voyage_add_reservation(WRITE) / voyage_import_reservation(WRITE) / voyage_get_trip_state / voyage_get_active_events / voyage_get_constraints / voyage_analyze_event_impact / voyage_propose_event_replan(WRITE)

## 7. Agent 工具策略（/api/agent/tools）

新增白名单：get_trip_state、get_reservations、get_active_events、analyze_event_impact、get_constraints、propose_event_replan。
System prompt 决策序：`get_trip_state → get_active_events → analyze_event_impact → propose_event_replan`；工具要点重写（replan_trip=某天交通顺序 / propose_change=通用修改 / propose_event_replan=事件驱动重规划 / optimize_transport=两点间交通）。同步维护 tests/agent-tools-context.test.ts 锁定断言。

## 8. Provider 接口（先接口后付费 API）

- `TravelEventProvider`（src/skill/event-providers.ts）：`poll(trip, since) → TravelEvent[]`、`subscribe?()`、`normalize(raw) → TravelEvent`；实现：MockTravelEventProvider（延误/暴雨/关闭/晚点/堵车可注入）+ WeatherEventProvider stub（现有 AMap 天气 normalize 成 WEATHER_CHANGED/HEAVY_RAIN/EXTREME_HEAT）。
- `FlightStatusProvider`：`getFlightStatus(flightRef) → FlightStatus`（departure/arrival/delay/cancel/divert + provenance）→ normalize 成 TravelEvent。接口先行，不绑定任何供应商；未来可接 FlightAware AeroAPI 等。
- 四种事件来源模式：Webhook（未来）/ Polling / Manual（record-travel-event）/ Simulation（simulate-travel-event，DEMO）。
- 边界：Provider response 永不直接进 Runtime——必须 normalize 成 TravelEvent 再入库。

## 9. TripState / Impact / Constraint 实现原则

- 全部纯函数、确定性、可单测；LLM 零参与。时间统一 Asia/Shanghai（沿用现有 currentDayId 时区约定）。
- TripState 输入 = Trip + asOf；内部消费 dayStats、buildWeatherContext、constraint engine、active reservations/events。
- Impact 引擎 = 事件类型 × 规则矩阵（如 USER_LATE：找「下一个未完成 item 的 startTime 比实际晚」→ at-risk；dinner reservation protected→impossible drop；输出可执行 options）。LLM 只解释 ImpactResult，不判断依赖。

## 10. Testing（golden 15 案例 + 性能）

tests/golden/phase6-cases.test.ts + tests/brain/trip-constraints.test.ts + tests/skill/reservations.test.ts + tests/trip-state/*.test.ts + tests/impact/*.test.ts：
①航班延误90min保酒店入住 ②14:00暴雨户外→室内 ③晚45min保晚餐预订砍低优先POI ④高铁出发时刻不可越过 ⑤景点关闭找替代 ⑥步行超限减负 ⑦预订取消释放窗口 ⑧事件数据 UNKNOWN 不伪造 ⑨拒绝 Proposal Trip 不变 ⑩双事件并发 revision 正确 ⑪proposalToken 过期拒绝 ⑫Agent 直 apply 必败 ⑬Offline 读最后缓存 TripState 且标 stale ⑭Provider 故障优雅降级 ⑮并发两 replan 一成一 REVISION_CONFLICT。
性能断言（单元级）：getTripState / analyzeEventImpact / evaluateTripConstraints 各 <100ms（golden fixture）；propose-event-replan 无 Provider 调用 <1s。

## 11. Traveler Memory v1（保守）

仅记录明确行为/选择（walkingTolerance/pace/transport/meal/wake/hotel/budget/style）。每条：source/explicit|inferred/confidence/updatedAt/evidence[]；inferred 需多次行为 + confidence 渐增 + 时间衰减；explicit 永远覆盖 inferred。可查看/修改/删除/禁用（四命令）。Planner 使用时输出「根据你的旅行偏好…」披露。无敏感个人数据。

## 12. 实施顺序与 commit 划分

| # | commit | 内容 | 验证 |
|---|---|---|---|
| 0a | feat(brain): phase 4.1 | 已完成 45668f0 | vitest 298 |
| 0b | merge open-source-readiness + 分支收敛 | 已完成 2f37067 + 9e915b4；远端仅剩 main；6 旧分支打 archive tag | vitest 332 + build + lint |
| 0c | docs: audit | CURRENT_ARCHITECTURE.md + 本文件 | — |
| 6.1 | feat(reservation-domain) | schema + 5 命令 + MCP 3 工具 + tests | lint/tsc/vitest |
| 6.2 | feat(constraint-engine) | trip 级评估 API + 预订硬约束 + 接 optimizer | 同上 |
| 6.3 | feat(travel-event-model) | schema + 2 命令 + tests | 同上 |
| 6.4 | feat(trip-state-engine) | 纯函数引擎 + get-trip-state + MCP + perf 断言 | 同上 |
| 6.5 | feat(impact-engine) | 规则矩阵 + analyze-event-impact + MCP | 同上 |
| 6.6 | feat(event-replan) | propose-event-replan + agent 工具/prompt + 场景测试 | 同上 |
| 6.7 | feat(today-console) | Execution Console + 主动卡片 | 同上 |
| 6.8 | feat(event-providers) | Provider 接口 + Mock + simulate 命令 | 同上 |
| 6.9 | feat(traveler-memory) | memory 服务 + 4 命令 + 披露语 | 同上 |
| 6.10 | test(golden)+docs | 15 案例 + perf + 文档收尾 | 全量 + build + Playwright |

## 13. 风险登记与回滚

| 风险 | 缓解 |
|---|---|
| 合并/新域破坏安全链 | 安全链零改动；每步 vitest 全量含 proposal-token/golden 回归 |
| Trip payload 膨胀（events 累积） | events 上限（如 200 条）+ acknowledged 归并；后续再上独立表 |
| 时区/日期 bug（历史已两次踩坑） | 全部 UTC 锚定测试辅助 + Asia/Shanghai 显式时区 |
| 分支历史丢失 | 已打 archive tag 推送 origin |
| 性能退化 | TripState/Impact/Constraint perf 断言进 CI |
| 每步可回滚 | 单 commit revert；新字段全部 optional，旧 Trip 兼容 |

## 14. 禁止事项（全程生效）

不重写项目；不建第二 Runtime；不加 prompt hack；逻辑不交给 LLM；Provider 响应不直接当 domain model；模型不自动确认 Proposal；不伪造航班/天气/交通事实；不自动预订/支付；不做登录/会员/支付优先；不破坏开源体验。
