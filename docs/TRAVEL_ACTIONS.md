# Voyage TravelAction 3.0 规范与执行器手册 (TRAVEL_ACTIONS.md)

> Voyage 的核心哲学：**AI 不能直接通过自然语言黑盒篡改 Trip，必须将自然语言解析为强类型 TravelAction，由纯函数 Executor 计算产生 TripChangeSet，经由用户确认后方可落地生效。**

---

## 1. 架构总览

```
用户自然语言输入（“今晚少走一点 / 下雨了 / 今天省100”）
    ↓
[ActionPlanner] (服务端 LLM 或规则降级)
    ↓
[Zod Schema 校验] (严格防注入、非法 ID 拦截)
    ↓
[Action Executor] (纯函数操作 Trip 副本)
    ↓
[Routing & Budget Recompute] (路网时间重算与预算刷新)
    ↓
[TripChangeSet Diff Engine] (量化生成步行减少量、交通置换、费用差值)
    ↓
[TripDiffModal] (前端展示前后对比弹窗，用户点击“应用修改”)
    ↓
[useHistoryStore & Persistence] (压入撤销栈 + 持久化保存)
```

---

## 2. TravelAction 3.0 完整清单 (24 种动作)

### 基础行程编辑类
| Action Type | Payload 结构 | 说明 |
|---|---|---|
| `MOVE_ITEM` | `{ itemId: string, toDayId: string, order?: number }` | 跨日移动行程节点 |
| `CHANGE_DAY` | `{ itemId: string, toDayId: string, order?: number }` | 同 MOVE_ITEM |
| `REMOVE_ITEM` | `{ itemId: string }` | 移除行程节点并重算当日路线 |
| `ADD_ITEM` | `{ placeId: string, dayId: string, startTime?: string, durationMinutes?: number }` | 向指定日期追加地点 |
| `REPLACE_ITEM`| `{ itemId: string, placeId: string }` | 就地替换已有行程节点 |
| `CHANGE_TIME` | `{ itemId: string, startTime: "HH:mm" }` | 调整单个节点开始时间 |
| `EXTEND_STAY` | `{ itemId: string, additionalMinutes: number }` | 延长景点停留时间 |
| `SHORTEN_STAY`| `{ itemId: string, reduceMinutes: number }` | 缩短停留时间（保底15分钟） |

### 路线与交通调控类
| Action Type | Payload 结构 | 说明 |
|---|---|---|
| `OPTIMIZE_DAY` | `{ dayId: string }` | 贪心最近邻算法重排单日节点，消除回环折返 |
| `REDUCE_WALKING`| `{ dayId?: string, maxWalkMeters?: number }` | 全行程长步行切换为地铁/打车 |
| `REDUCE_TODAY_WALKING` | `{ dayId: string, maxWalkMeters?: number }` | 针对当天的紧急少走路（超标步行全切打车） |
| `CHANGE_TRANSPORT` | `{ itemId?: string, dayId?: string, mode: TransportKind }` | 批量或单段更改交通工具 |
| `CHANGE_ROUTE_MODE`| `{ segmentId?: string, fromItemId?: string, toItemId?: string, newMode: TransportKind }` | 单一路段精准改乘 |

### 预算控制类
| Action Type | Payload 结构 | 说明 |
|---|---|---|
| `REDUCE_BUDGET` | `{ amount: number, reason?: string }` | 全程总预算按比例削减（非交通类） |
| `REDUCE_TODAY_BUDGET` | `{ dayId: string, targetSaveAmount: number }` | 今日精准省钱（打车改地铁 + 调整就餐计划） |

### 现场即时决策类 (Today Mode Dedicated)
| Action Type | Payload 结构 | 说明 |
|---|---|---|
| `RAIN_PLAN` | `{ dayId?: string, preferIndoor?: boolean }` | 下雨预案：室外露天景点替换为室内博物馆，长步行收缩 |
| `MOVE_INDOOR` | `{ dayId: string, outdoorItemId?: string }` | 选定露天节点替换为室内展馆 |
| `DELAY_DAY` | `{ dayId: string, minutes: number }` | 晚起/推迟：当天所有后续节点顺延指定分钟数 |
| `START_EARLIER` | `{ dayId: string, minutes: number }` | 提前出发：当天所有节点前移 |
| `SKIP_NEXT` | `{ dayId: string, currentItemId?: string }` | 跳过当前站点，直奔下一站 |
| `CHANGE_NEXT_PLACE` | `{ dayId?: string, currentItemId?: string, category?: string }` | 换个地方：寻找同类备选 POI |
| `FIND_NEARBY_FOOD` | `{ dayId: string, nearItemId?: string, cuisine?: string }` | 寻找附近正宗美食并插入午饭/晚饭时间槽 |
| `RECOMMEND_FOOD` | `{ dayId?: string }` | 推荐未体验过的当地特色美食 |
| `RECOMMEND_PLACES` | `{ dayId?: string }` | 推荐未体验过的热门地标景点 |

---

## 3. TripChangeSet 差异比对系统

每个返回 Proposal 的动作都会由 `computeTripChangeSet()` 生成量化对比报告：
```ts
export interface TripChangeSet {
  id: string;
  summary: string;
  metrics: {
    walkDistanceBeforeMeters: number;
    walkDistanceAfterMeters: number;
    walkDistanceDiffMeters: number; // 负数表示减少步行
    walkDurationBeforeMinutes: number;
    walkDurationAfterMinutes: number;
    walkDurationSavedMinutes: number; // 正数表示节省体能时间
    estimatedCostBefore: number;
    estimatedCostAfter: number;
    costDiff: number; // 费用变化
    transitChanges: TransitChange[];
  };
  itemChanges: ItemChange[];
  actions: TravelAction[];
  beforeTrip: Trip;
  proposedTrip: Trip;
}
```

前端 `TripDiffModal` 会将上述数据转化为直观的 Linear-style 审阅卡片，用户不满意随时点击“放弃修改”，完全杜绝 AI 胡乱改动行程造成失控。
