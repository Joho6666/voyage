# Changelog

本文件记录面向使用者的显著变更。日期为合并到 main 的日期。

## 2026-10-03 · 安全加固与无障碍提升

- **限流桶不再信任客户端 IP**：X-Forwarded-For 完全由客户端控制，直接部署时每个请求可以伪造新 IP 绕过限流；现在只用会话 cookie 作为桶 key，反向代理场景可自行加回可信 IP。
- **写命令补齐限流**：remove-item / remove-day / set-item-status / reorder-day / restore-trip / apply-change / optimize-itinerary 等 14 个改写型命令进入 `write` scope（60 次/分钟），optimize-itinerary 并入 `llm` scope；此前这些命令可无限调用。
- **后台生成并发闸**：detached 生成 worker 上限 2 个（此前只靠会话状态锁，多会话并发仍可无限消耗 LLM 配额）；超出时返回 429。
- **外链 schema 强化**：社交证据 schema 新增 `socialHttpsUrlSchema`，仅接受 `https://` URL（zod 的 `.url()` 默认接受 `javascript:`）。
- **键盘可达性**：Today 打卡行改为 `role="checkbox"` + `aria-checked`，支持 Enter/Space 键切换；PoiCard 卡片和地图标记均补齐键盘可达；hover-only 的拖拽手柄和更多菜单在键盘聚焦时可见。
- **CommandPalette / 移动端更多面板**：Esc 键关闭（此前显示 Esc 提示但实际无效）；对话框补 `aria-label`；全局启用 `prefers-reduced-motion`，地图 ping 脉冲和弹出动画在减少动画模式下禁用。
- **离线模式可回退**：行程布局在网络请求失败时尝试读取已缓存的离线行程包（`getCachedTrip` 此前零调用），渲染行程并在顶部显示离线提示；Service Worker 改为 network-first + 缓存回退，为未缓存的离线行程返回 504 而非静默失败。
- **测试覆盖**：新增离线回退 E2E、删除日命令 E2E（两段式确认）；更新 README 测试数量（301 单元测试，39 条 E2E）。

## 2026-10-01 · 开源开箱即用（README + Auth 弱化）

- **README 第一屏重写**：标题改为 "Open-source AI-native Travel OS"，一屏列出核心承诺（No account required / Local-first / BYO API keys / Real POI·route·weather / 攻略导入 / AI 排程 / Today 执行模式 / Skill+MCP），并新增 **Provider 分级表**：Level 0 Demo（零配置可完整体验）→ Level 1 AMap → Level 2 LLM → Level 3 Social/Offers，明确"不配任何 Key 也能用"。
- **账号入口弱化**：侧栏账户按钮文案从"点击登录与同步"改为"可选 · 数据保存在本地"，明确无需注册即可完整体验（登录仅为可选跨设备同步）。不删除 Supabase 代码，保持 Optional。

## 2026-10-01 · Today Mode v2（旅行执行控制台）

- **新只读命令 `get-today-context`**：一次返回当前站、下一站（名称、停留、真实距离与推荐交通含估算标注、建议出发/预计到达时间）、今天剩余（地点数、剩余步行米数、预计结束时间）、比计划晚了多少分钟、当天天气（带 provenance，未知保持未知）、以及确定性规则建议（下雨 / 剩余步行超限 / 落后于计划 / 下一站过远）。全部建议都是 advisory：任何修改仍走 propose → Diff → 用户确认。
- **纯函数在 service 层共享**（`src/services/today/context.ts`）：runtime 命令与 Today 页控制台使用同一份计算，页面显示的剩余步行/预计结束与 Agent 看到的数字永远一致，不重复业务逻辑。
- **Today 页新增执行台条**：导航按钮下方常显"今天剩余 N 个地点 · 剩余步行 X km · 预计结束 HH:mm"，迟到超过 30 分钟时显示"比计划晚了约 N 分钟"提示；已完成/跳过地点不计入剩余，也不被重排。
- **MCP**：新增 `voyage_get_today_context`（只读）；命令暴露矩阵同步。
- 6 项新测试：当前/下一站与交通计算、done 不计入剩余、迟到检测、雨天建议、剩余步行建议、未知天气不伪造。

## 2026-10-01 · Itinerary Optimizer v1（智能排程）

- **新 Runtime 命令 `optimize-itinerary`**：对已有行程的 planned 条目做整体重排——按经纬度地理聚类（farthest-first 确定性种子 + k-means，无随机）、日内 nearest-neighbour 链、时间窗就位（观景/夜景放晚间档、餐饮锚定正餐）、用户画像生效（pace 控制每日密度、low 步行耐受触发日步行预算并把最孤立地点外移、elderly/children 降低密度）、雨天室内优先并把高体力户外移出。**始终产出提案**（Diff + proposalToken），用户确认后才应用；done/current 条目原地保留；无法排程的事实（营业时间 unknown、无天气预报）如实记入 unresolvedConstraints，绝不伪造。
- **攻略导入接入优化器**：规划会话贴链接生成、行程页一键导入两处的"按攻略顺序平均切块"替换为 `optimizeGuideDayAssignment`——攻略原始顺序保留为信号（聚类种子与 tie-breaker），地理相近的地点优先同日，导入 toast 展示排程理由。
- **解释而非黑箱**：每次排程输出 `decisions[]`（基于真实距离/类型/天气/画像的中文理由，如"洪崖洞与解放碑两地相距约 350 m"）、`warnings[]`、`estimatedWalkingMetersByDay`。
- **MCP**：新增 `voyage_optimize_itinerary`（WRITE annotation，返回 Diff 摘要）；命令暴露矩阵文档化于 `docs/RUNTIME_COMMAND_EXPOSURE.md`。
- 12 项 Optimizer 纯函数测试 + 4 项 runtime proposal 流测试；验收场景（桂林→重庆 8 地点 3 天）通过：磁器口（西）不与南山（东南）同日、南山一棵树排晚间、低步行偏好显著降低总步行、同输入输出完全确定。

## 2026-10-01 · MCP 确认机制加固（proposalToken）

- **提案应用必须携带一次性 proposalToken**：`propose-change`（含 replan 产生的提案）现在签发短时效（默认 10 分钟，可通过 repository 选项调整）、一次性、绑定 tripId + revision + changeSet 哈希的 token；`apply-change` 缺 token、token 错误、过期、已消费、revision 漂移或 changeSet 被篡改时分别以 `PROPOSAL_TOKEN_REQUIRED` / `PROPOSAL_TOKEN_INVALID` / `PROPOSAL_EXPIRED` / `PROPOSAL_ALREADY_APPLIED` / `PROPOSAL_STALE` / `PROPOSAL_TAMPERED` 明确拒绝。服务端只存 token 的 sha256，明文只出现在 propose 响应里。此前 MCP 端模型可以自己 propose 再自己 apply（`confirmed:true` 模型可自行填写），现在这条捷径被关闭。
- **MCP 工具补齐 annotations**：全部 12 个工具改用 SDK `registerTool` 注册——9 个只读查询工具 `readOnlyHint: true`，`voyage_create_trip` / `voyage_propose_change` 非破坏性写，`voyage_apply_change` 标注 `destructiveHint: true`，宿主（Claude Desktop / Cursor 等）可据此弹确认。顺手补上 `voyage_propose_change` 缺失的 `asOf` 参数。
- **propose 返回人类可读 Diff 摘要**：步行距离前后与差值、费用差、交通方式置换、条目增删明细，以及「先展示 Diff 征得同意」的提示，Agent 可原样展示给用户。
- **Web 端透明接入**：Diff 弹窗确认后自动透传 proposalToken（token 只增时效与防篡改，用户点击仍是唯一确认来源）。
- SKILL.md 与 runtime-api.md 已同步 ADAPT 规则与新错误码。

## 2026-09-30 · 规划对话内粘贴链接 → 自动成图

- **在规划页直接粘贴小红书/抖音链接**：对话框输入框支持直接贴链接（含 xhslink.com、v.douyin.com 短链），服务端解析短链、抓取笔记/视频正文、抽取地点并由高德逐个核实；对话里出现「已核实 N 个地点」卡片，可点选剔除识别错误的地点。生成路线时这些地点按链接原文顺序排进每天、地图自动连线，并生成「到达后打卡」任务清单。
- **上游端点迁移**：小红书详情从已下线的 `web_v3`（实测 400）迁移到 `app_v2`（`share_text` 直吃分享链接，实测无需 token）；抖音走 `fetch_one_video`（实测返回正文）；社会 Provider 解包链补充 `aweme_detail` 与两种小红书卡片结构。
- **安全加固**：
  - 新增 `assertPublicFetchUrl`（用户输入的 URL 专用严格校验）：除既有私网/环回外，拦截整数字面量（`2130706433`）、十六进制、八进制前导零、IPv6 环回/ULA/链路本地/组播，以及 CGNAT、基准测试段与 TEST-NET 保留段；原有宽松校验保留给管理员配置路径，避免误伤自建服务。
  - 短链解析走手动重定向（≤3 跳），**每一跳**都校验平台域名白名单与公网地址（SSRF 防护）。
- 链接解析失败时如实提示并引导改用「粘贴攻略文本」（探索页入口），绝不伪造内容。

## 2026-09-30 · 攻略一键导入 + 打卡联动任务

- **一键导入整条攻略路线**：探索页的攻略面板新增「一键生成路线图」——解析出的全部真实地点按攻略原文顺序自动分配到各天（均匀切分），在一次服务端事务内导入并逐天重算路线，地图立即连线。原来只能逐个勾选循环加入（中途失败会留半成品）。
- **粘贴任何平台的攻略**：新增粘贴入口，抖音 / 微信 / 小红书 / 任意平台的攻略原文都能解析（抽取器不限平台）；在线检索仍来自小红书。面板文案从「小红书专属」改为「攻略导入 · 小红书 / 抖音 / 微信」。
- **自动生成打卡清单**：导入的每个地点都会生成一条「到达后打卡」任务（linkedItemId 关联到行程条目），按天分组显示在任务 tab。
- **打卡联动自动划掉**：今天页打钩一个地点，其关联任务自动划掉；取消打卡则任务对称回退。任务清单的勾选现在真实落库（新命令 set-task-status，此前只改本地刷新即丢）。
- **行程时间线显示完成状态**：已完成的节点在行程列表里显示划线 + 「已完成」徽标。
- 新增运行时命令 `import-route` 与 `set-task-status`（均带 revision 锁与来源校验：导入地点必须可追溯到高德/演示真实数据，找不到的不编造）。

## 2026-09-29 · Agent 强化（工具可见 + 主动牵引）

### 工具调用透明化
- `/api/agent/tools` 返回结构化 `toolCalls` 轨迹（工具名 / 参数摘要 / 结果摘要 / 成败），前端在回复卡中以徽标展示「调了什么、查到了什么」。
- LLM 的自然语言解释不再被 runtime 固定 summary 覆盖：提案场景下解释与提案同时呈现。
- 工具循环达到 3 轮上限时不再丢弃全部结果，返回已获取的部分数据与说明。

### 主动牵引
- 今天页新增「建议条」：确定性规则基于行程事实（未来下雨/高温、空白天或只排 1 个点、预估超预算、步行过长、从未查报价、出发前待办）主动给出最多 3 条可点击的下一步，点击即交给 Agent 执行。
- system prompt 注入今天日期与行程阶段、剩余行程天的天气摘要、每个工具的「何时用」引导，并要求模型在回答末尾主动建议下一步（信息不足直接反问）。
- get_trip 工具投影扩充：向模型提供待办任务数、报价条数、逐日天气，一次调用即可感知全局。

### 会话感
- 今天页 AI 请求现在携带最近 8 轮对话历史（服务端本就支持），「再少一点」这类追问可以正确解析。
- Agent 回复从一次性 toast 改为持久回复卡（内容 + 工具徽标 + 警告 + 已关闭 Diff 的「查看修改方案」回入口）。
- 删除不可达的 applyConfirmation 路由分支与本地 apply 死代码路径。

## 2026-09-29 · 减法重构（开箱即用）

以「步骤更少、入口更少、开箱即用」为目标的产品减法，四批独立提交。

### 创建流程
- 对话成为唯一创建路径：移除「不想先聊天？直接填写并生成」的第二入口（两条路径本就共用同一画像面板，切换只是位置不同）。画像面板保留在对话视图右侧，硬信息（日期/人数）可随时手填，Agent 也会主动追问。最少路径：一句话 → 回答追问 → 生成。

### AI 交互
- 行内 AI 收敛为唯一入口：今天页「需要帮忙」抽屉 = 8 个一键调整 + 自然语言输入框（吸收原 AI 助手侧板的自由对话能力）。删除 AssistantSheet 侧板与 TopBar「AI 助手」按钮。
- Cmd+K 命令面板改为纯导航 + 地点搜索：删除与其余入口逐字重复的 6 条 AI 指令组及整套 Diff 机制。

### 页面
- 行程内子页从 10 个收敛为 5 个：行程主页 / 今天 / 探索 / 交通 / 预订推荐。
- explore 吸收美食/住宿/活动三个页面的发现管线与「已收录」列表（按类别 tab 条件渲染，真机验证酒店 POI 与美食分类正常）；三个页面连同其重复的报价卡与 locateOnMap 副本一并删除。
- 报价只看「预订推荐」页：transport 页的内嵌跨城报价卡与重复刷新按钮移除，保留规划参考、能力面板、市内多模式对比与官方核实入口。
- tasks 清单内联进行程主页的任务 tab；budget 明细折叠进今天页的预算卡。
- 导航随之精简：侧栏 10 项 → 5 项，移动端「更多」抽屉 11 项 → 6 项。

### 清理
- 删除约 1,300 行零引用死代码：4 条无人调用的飞猪路由、weather 路由、agent/create 与 agent/plan-actions 遗留路由、skill/trips 裸读路由、redfox 社交链路（其 schema 枚举值保留以兼容历史数据）、live-search、旧地图孤岛（amap/controller/types）、3 个死地图 hook、零引用 UI 组件与类型。
- package.json：移除 6 个零引用 @radix-ui 包；测试工具链（vitest/jsdom/@testing-library 等）从 dependencies 移回 devDependencies。
- .env.example：删除零读取的 NEXT_PUBLIC_APP_URL 与非用户配置的 MEITUAN_RAW_JSON、REDFOX_API_KEY。

## 2026-09-29 · 审计跟进修复

### 真机测试补充修复（自动化实测发现）
- 新增 `add-place` 运行时命令：「加入地图标记」「地图定位」不再只写本地 store——探店/酒店/攻略地点标记现在真实落库，刷新后保留（真机实测服务端 places 6→7 且刷新后徽标仍在）。
- 探索页搜索结果被本地字面过滤二次筛选导致空白：高德语义匹配的 POI（名称不含查询词的品牌等）现在正常展示（实测 16 张卡片）。
- 分享按钮剪贴板写入失败不再抛出未捕获异常，改为如实提示。

### 信任与正确性
- 封堵限流旁路：`/api/voyage/command` 按命令映射到对应付费接口预算（create/replan→规划、propose/知识→LLM、地点/路线/天气→高德、报价/机票→飞猪、社交→社交），`/api/agent/create` 并入规划预算；本地读写命令不限流。
- 限流器加固：访客 Cookie 必须是合法工作区 UUID，否则并入匿名桶（杜绝伪造 Cookie 撑爆内存）；桶数量硬上限 1 万，插入序淘汰。
- 新增 `set-item-status` 运行时命令：「今天」页打卡现在走服务端 revision 锁持久化，刷新不再丢；失败自动回滚乐观 UI 并提示。
- 行程排序失败回滚快照并如实提示（原先静默吞错，本地与服务端漂移）；`persist()` 增加异常保护。
- `add-place-item` 幂等命中不再空转 revision；`reorder-day` 拒绝不存在的 dayId。

### 移动端体验
- 底栏「地图」改为折叠行程面板露出真实地图（`/explore` 在手机上没有地图）；「行程 / 地图」高亮随面板状态区分。
- 地图浮窗不再被底栏遮挡；「行程预演」按钮在面板展开时隐藏（移动端），桌面不受影响。
- EXPLORE 选中的地点不再泄漏到 PLAN 模式；TopBar 新增 AI 指令按钮（手机无 Cmd+K）；会话恢复「开新的」按钮在恢复中禁用。

### 数据卫生
- 分享文件字段白名单化：只存只读页所需的行程骨架，规划画像、原始输入、社交证据、报价与预算明细不再进入可分享的文件。
- `shares/` 过期分享文件自动清理（此前只增不减）；访客侧清理增加 10 分钟去抖，防止请求风暴放大磁盘扫描。
- 攻略地点抽取的降级原因（LLM 回退、QPS 限流）现在展示在面板中，不再被前端丢弃。
- 服务端日志补齐：command/agent-create 的 500、攻略抓取与地点解析失败、LLM 大纲与对话降级、高德路线回退，全部接入结构化日志。

## 2026-09-29

### 批次 C · 工程清理
- 删除 8 个验证无引用的死文件（旧地图集群 `AMapCanvas` / `MockMap` / `PoiPreview` / `NumberMarker`、`JourneyMapProvider`、`social/store`、`booking/mock`、`lib/telemetry`）。
- 卸载死依赖：`recharts`、`react-hook-form`、`@hookform/resolvers`、`@tanstack/react-query`（并移除空壳 QueryClientProvider）。
- `@supabase/supabase-js` 改为按需动态加载（auth 与行程远端仓库首次调用时才拉起），移出首屏客户端 bundle。
- CI 单次构建：E2E 复用构建产物（`PLAYWRIGHT_REUSE_BUILD=1`），消除一次运行内的两次 `next build`。
- README 功能亮点、验证数字、环境变量表更新。

### 批次 B · 运维加固
- 付费接口限流：高德（60/分）、社交 / LLM / 飞猪（15/分）、规划（10/分），按访客 Cookie + IP 滑动窗口，超限 429 + Retry-After；单实例内存实现。
- 服务端结构化 JSON 日志；18 处静默吞错 catch 接入日志（天气 / POI 降级 mock、LLM 规划降级、社交 provider 失败、飞猪房态、城市封面、美团输出等）。
- 访客工作区过期清理：默认 30 天（`VOYAGE_GUEST_TTL_DAYS` 可调，`0` 关闭），仅清理 UUID 形状且只含已知子目录的访客目录，绝不触碰当前访客。
- 修复：`logger` 不得携带 `server-only`（独立 CLI 依赖链需要它，`skills/voyage` 冒烟测试钉住该行为）。

### 批次 A · 产品批
- 移动端导航补全：底栏 4 主位（行程 / 今天 / 地图 / 更多）+ 分组「更多」抽屉，`today`、`food`、`activities`、`transport`、`budget` 手机首次可达；消除地图 / 行程重复指向；分享按钮移动端可见；非行程页增加全局底栏。
- 规划会话恢复：会话指针持久化（`voyage-planning`），规划页提供「继续上次规划」，失效指针如实清理；服务端会话与恢复接口本就存在，零服务端改动。
- RedFox 移出社交证据路由（其文档化端点仅返回抖音账号资料，无法产出帖子证据）；账号搜索通道与设置页说明保留。
- 抖音上游 400 实测确认：按 TikHub 文档默认参数仍 400，属上游端点故障，维持如实显示。

## 2026-09-28

- 小红书攻略功能：攻略面板（路线 / 必吃美食 / 最新笔记 / 自定义搜索四类）、地点抽取 → 高德解析 → 一键定位 / 入图 / 排入行程；美食与酒店页地图集成，选中地点在任意图层强制可见。
- 信任批次：天气未知不再显示假温度（`weatherDisplay`）；`/api/agent/tools` 等路由报错不再泄漏 Zod dump（`failureMessage`）；新增 `add-place-item` 运行时命令（强制真实 provenance，拒绝无来源地点）；7 天上限单一真相源 `src/lib/trip-limits.ts`；设置页 RedFox 诚实标注；移除「收藏」假入口。
- 画像可表达性修复：规划画像日期跨度与天数对齐，`days` 派生值不再溢出 schema 泄漏原始报错。
- 天数单一真相源、社交来源链接推导（xiaohongshu / weibo / douyin 平台规范 URL）、地图单日聚焦。

## 迁移说明

`supabase/migrations/` 存在两个 `0003_` 前缀文件（`0003_route_provenance.sql`、`0003_travel_knowledge.sql`）。两者均已在远端以独立时间戳版本应用（`voyage_0003_route_provenance` → `voyage_0003_travel_knowledge`，见 Supabase 迁移历史）。**请勿本地重编号**，否则 CLI 与远端历史将无法对账。
