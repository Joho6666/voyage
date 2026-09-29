# Changelog

本文件记录面向使用者的显著变更。日期为合并到 main 的日期。

## 2026-09-29 · 审计跟进修复

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
