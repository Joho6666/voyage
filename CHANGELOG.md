# Changelog

本文件记录面向使用者的显著变更。日期为合并到 main 的日期。

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
