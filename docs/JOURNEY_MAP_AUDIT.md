# Voyage Journey Map 深度审计与改造方案

**日期**: 2026-09-05  
**分支**: `feat/phase3-beta`  
**模块**: `src/components/map/*`, `src/services/map/*`, `src/features/journey-map/*`

---

## 一、当前实现现状审计

经过对 `src/components/map/*`、`src/services/map/*`、`src/services/routing.ts`、`src/store/*`、`src/components/itinerary/*` 以及各页面路由的完整审计，现有地图系统存在以下 12 个关键问题：

### 1. AMapCanvas 初始化与底图样式
- **底图杂乱**：采用高德默认 2D 底图，未配置 `mapStyle`（缺少 whitesmoke/light 定制），背景高饱和颜色、商户广告与密集 POI 标签喧宾夺主，完全破坏了 Travel OS 应有的克制感（Apple Maps / Linear / Notion 质感）。
- **静态中心点**：初始化仅以 `trip.places[0]` 为中心，缺少根据整趟旅行范围计算的标准边界初始化。

### 2. Marker 渲染逻辑
- **粗糙的内联 HTML 拼接**：使用字符串拼接 `<div style="width:22px;height:22px;border-radius:999px;background:...>`。
- **缺乏视觉层级与语义**：
  - 所有地点都是单调的圆形数字序号（① ② ③）。
  - 没有区分 **Next（下一站）**、**Completed（已打卡）**、**Hotel（酒店）**、**Food（餐饮）**、**Transport（枢纽）** 与 **Explore（探索点）**。
  - Hover 状态缺乏横向标签展开，Selected 状态缺乏高度感知与时间信息。

### 3. Polyline 渲染逻辑
- **粗暴按天合并**：每天所有路段被强行拼成单一的 `MapPolyline`，忽略了具体路段的交通模式（步行、地铁、公交、打车、自驾）。
- **视觉千篇一律**：所有路线统一为 4px 实线，完全无法区分“步行细虚线”、“地铁双轨/粗实线”、“打车分段线”。
- **真实路线与预估路线混淆**：高德实时航线与直线 Haversine 预估线没有任何视觉区隔，严重误导用户对真实路况和耗时的预期。
- **缺乏交通胶囊（Route Capsule）**：路线中间没有任何时间、耗时、费用标识（如 `🚶 12 min`、`M · 18 min`、`🚕 14 min · ¥22`）。

### 4. selectedPlaceId / 5. hoverPlaceId
- 选中地点仅调用 `map.panTo`，Marker 未呈现 Selected 特殊微件（阴影、时段、标牌）。
- Hover 状态在 `AMapCanvas` 中几乎无效（没有事件绑定与轻量扩展，甚至无法触发受影响 Overlay 的精准微调）。

### 6. activeDayId 与天数筛选
- 现有逻辑仅在 `controller.ts` 中通过透明度 `color: `${line.color}55`` 做简单置灰。
- 没有提供地图顶部的天数快速切换控制器（全部 / Day 1 / Day 2 / Day 3）。
- 切换天数时不会自动聚焦该天的地理范围（`fitDayBounds`）。

### 7. mapFilters 与信息密度
- `AMapCanvas` 甚至没有放置过滤器组件，过滤状态无法在真实地图上交互。
- 无论缩放层级（Zoom Level）多大，所有元素同时展示，高缩放级别缺少路段胶囊，低缩放级别缺少聚合，导致画面拥挤。

### 8. Camera / fitView 交互缺陷（严重夺取用户控制权）
- **严重 Bug**：在 `AMapCanvas.tsx` 中，每次 React 状态变化（哪怕是 hover 或数据轻微变动），都会执行：
  ```ts
  if (overlays.current.length) map.setFitView(overlays.current, false, [60, 60, 60, 60]);
  ```
  这导致用户一旦手动平移或缩放地图，稍有状态更新就被地图强行“拉回”，严重破坏操作体验。
- **缺少专用控制器**：缺乏针对 `fitTrip`、`fitDay`、`flyToPlace`、`focusRoute`、`focusCurrentLocation`、`reset` 的状态机管理与手势冲突拦截。

### 9. PoiPreview 展现形式
- 固定在左下角 `absolute bottom-4 left-4 z-20 max-w-[260px]`，遮挡左侧控件且样式孤立。
- 桌面端没有跟随 Marker 锚定或提供高阶 Float Card；移动端与底部抽屉（MobileTripSheet）产生重叠甚至被完全吞没。

### 10. Timeline ↔ Map 双向联动断裂
- 点击 Timeline 卡片虽然能 panTo，但点击地图 Marker 无法顺畅反向滚动居中 Timeline 列表；
- 悬浮 Timeline 卡片无法高亮对应路线；
- 无法在地图上直接点击路线路段来查看时间、距离与两端站点。

### 11. Mobile Layout 体验
- 底部抽屉在移动端覆盖高度可达 52% 或 88%，缺乏专用的 Mobile Map 模式与精简浮动按钮。
- 缺少单手可达的悬浮控制条（Toolbar）。

### 12. MockMap 投影与回退
- 纯 SVG 手绘伪地图，缺乏等比例地理投影转换与模式兼容，导致在无 AMap Key 状态下无法体验新交互。

---

## 二、全新 Journey Map 架构规划

在 `src/features/journey-map/` 下建立完整领域分层， AMAP 与 Mock 双引擎均基于统一的控制器与数据模型驱动：

```
src/features/journey-map/
├── JourneyMap.tsx                  # 顶层统一入口（自动区分 AMap / Mock）
├── JourneyMapProvider.tsx          # 状态与实例 Context
├── components/
│   ├── MapToolbar.tsx              # 悬浮控制条（定位、居中、图层、天数）
│   ├── DaySwitcher.tsx             # 顶部轻量 Segmented Control（全部/Day 1/2/3）
│   ├── PlaceMarker.tsx             # Marker 2.0 渲染模板与图标组件
│   ├── RouteBadge.tsx              # 路线中间交通胶囊
│   ├── MapPopover.tsx              # 桌面端锚定弹窗 / 移动端 Bottom Sheet
│   ├── JourneyOverview.tsx         # 行程总览浮层
│   ├── JourneyScrubber.tsx         # 行程时序模拟 Scrubber（实验功能）
│   ├── UserLocationMarker.tsx      # 当前位置定位点（带呼吸 Pulse）
│   └── NextStopBanner.tsx          # Today 模式下的下一站指引条
├── controllers/
│   ├── camera-controller.ts        # 智能相机控制器（防抢占机制）
│   ├── overlay-controller.ts       # 差量 Overlay 注册与增删改（高性能）
│   ├── marker-controller.ts        # Marker 2.0 状态衍生与 LabelMarker 适配
│   └── route-controller.ts         # 路线几何、交通样式与胶囊中点计算
├── models/
│   ├── map-state.ts                # MapMode (PLAN | TODAY | EXPLORE), ZoomLevel
│   ├── marker-model.ts             # Marker 语义状态模型
│   └── route-model.ts              # RouteSegment 视觉表达与胶囊模型
└── hooks/
    ├── useMapCamera.ts             # 相机操作钩子
    ├── useMapInteraction.ts        # 交互与双向联动钩子
    ├── useUserLocation.ts          # 浏览器定位与权限处理
    └── useMapZoom.ts               # 缩放监听与信息密度控制
```

---

## 三、实施原则与完成指标

1. **底图克制**：启用浅色 whitesmoke / light 高级定制主题，关闭不必要的商业 POI，突出旅行路线与节点。
2. **语义化 Marker 2.0**：
   - 普通序号（简洁圆形）
   - Hover 悬浮胶囊（展开名称）
   - Selected 重点高亮（带时间与光影）
   - Next 下一站（强对比徽标 + 预计到达）
   - Completed 已打卡（置灰或勾选）
   - Hotel / Food / Transport 专属图标
3. **路线多模态与胶囊**：
   - 步行（细虚线 🚶）
   - 地铁（双轨或粗实线 🚇）
   - 公交（中等线形 🚌）
   - 出租/自驾（清晰分段 🚕）
   - 路线中点胶囊显示耗时与费用
4. **稳定防抢相机的 Controller**：
   - 用户拖拽后锁定自动 fitView。
   - 提供显式「重置/居中」按钮。
5. **Timeline ↔ Map 双向无缝联动**。
6. **Today & Explore 差异化模式**：
   - Today 模式：实时定位、当前位置脉冲、下一站大卡片、路线聚焦。
   - Explore 模式：分类聚合、海量 POI Cluster。
7. **全量测试与回归通过**：
   - 包含单元测试 `tests/map/*`
   - Playwright E2E 交互测试覆盖。
   - `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e` 全绿。
