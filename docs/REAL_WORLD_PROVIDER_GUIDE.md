# Voyage Phase 3 真实服务提供商接入指南 (REAL_WORLD_PROVIDER_GUIDE.md)

> Voyage 是 AI-native Travel OS，核心架构原则：**拒绝假数据，所有路线与地点必须可追溯到真实服务商**。  
> 本指南详细说明 AMap 高德地图、天气服务、Booking Intent 预订意图层与 Supabase 的技术对接细节。

---

## 1. 高德地图 (AMap) 深度集成

### 1.1 架构分层
- **服务端 REST API (`src/services/map/amap-rest.ts`)**：
  - 拥有 `AMAP_SERVER_KEY` 保护，绝对不向客户端泄露。
  - 核心接口：
    1. `amapSearchPois({ keywords, city, types, offset })`: 调用 `/v3/place/text`，真实返回名称、地址、经纬度、评分与人均消费。
    2. `amapGeocode(address, city)`: 调用 `/v3/geocode/geo`，解析地址为精准经纬度与城市 adcode。
    3. `amapReverseGeocode(lat, lng)`: 调用 `/v3/geocode/regeo`，实现反向地名吸附。
    4. `amapWalkingRoute(origin, destination)`: 调用 `/v3/direction/walking`，提取真实路网折线（Polyline）、分段步数与步骤指引（Steps）。
    5. `amapDrivingRoute(origin, destination)`: 调用 `/v3/direction/driving`，提取自驾/出租车真实路网轨迹与时长。
    6. `amapTransitRoute(origin, destination, city)`: 调用 `/v3/direction/transit/integrated`，整合公交地铁换乘、步行接驳与线路轨迹。
- **内置缓存与防穿透代理 (`src/app/api/amap/route/route.ts`)**：
  - 对相同起终点与出行模式（30分钟内）做 LRU 内存缓存，避免频繁消耗高德每日调用额度。
- **客户端 JS SDK 2.0 (`src/services/map/amap-js.ts` & `src/components/map/AMapCanvas.tsx`)**：
  - 加载高德 2D/3D 矢量底图，根据 `MapRenderModel` 动态渲染分日彩色 Polyline 与序号 Marker。
  - 点击卡片平滑 `map.panTo([lng, lat])` 聚焦，点击 Marker 反向激活行程条目高亮。

---

## 2. 天气智能情报引擎 (Weather Intelligence)

### 2.1 数据获取与格式化
- 接口：`/v3/weather/weatherInfo?extensions=all`
- 根据城市 adcode 获取未来 3-4 天的最高温、最低温、白天/夜间天气现象。
- 自动计算日间体感温度，并归一化为统一枚举：`sun` / `cloud` / `rain` / `overcast`。

### 2.2 决策上下文 (WeatherContext)
- `src/services/weather/context.ts` 构建标准天气上下文对象：
  ```ts
  export interface DayWeatherContext {
    dayId: string;
    date: string;
    tempC: number;
    condition: string;
    isRainy: boolean;
    isHeavyRain: boolean;
    isExtremeHeat: boolean; // > 34°C
    advisory: string;
    recommendedAction?: "RAIN_PLAN" | "MOVE_INDOOR" | "REDUCE_WALKING";
  }
  ```
- **智能推理规则**：
  - `isRainy === true`：系统提示“下午有雨”，Today 页面出现快捷“换下雨方案”胶囊，AI ActionPlanner 自动偏向室内展馆。
  - `isExtremeHeat === true`：系统提示避开正午烈日暴走，长距离步行自动推荐地铁或打车。

---

## 3. 预订意图层 (Booking Intent Layer)

> **原则**：Phase 3 绝不自研 OTA 支付系统或爬取脆弱机票接口，而是建立可信的**跳转意图层 (Booking Intent Layer)**。

### 3.1 酒店 (Hotels)
- 提供区域选址分析（例如：为什么推荐住解放碑商圈）。
- 提供多渠道直达外部预订链接：
  - **携程旅行 (Trip.com)**：`https://www.trip.com/hotels/list?city=${city}&keywords=${hotelName}`
  - **高德地图酒店**：`https://uri.amap.com/search?keyword=${hotelName}&city=${city}`
  - **缤客 (Booking.com)**：`https://www.booking.com/searchresults.html?ss=${hotelName}`

### 3.2 大交通与现场导航 (Transport & Navigation)
- **高铁火车票**：直达携程火车票 / 12306 线路查询：`https://trains.ctrip.com/trainbooking/search?from=${from}&to=${to}`。
- **现场高德导航**：
  - 网页版通用协议：`https://uri.amap.com/navigation?to=${lng},${lat}&toname=${name}&mode=${mode}&policy=1`
  - 高德 App Deeplink：`amapuri://route/plan/?dlat=${lat}&dlon=${lng}&dname=${name}&dev=0&t=0`

---

## 4. Supabase 行级安全与持久化 (RLS & Auth)

### 4.1 安全加固规则 (`0002_rls_secure.sql`)
- 废弃 Phase 1 的开放策略，开启严格所有权检查：
  - `trips`：`using (auth.uid() = owner_id)`
  - 子表（`places`, `itinerary_items`, `route_segments`, `budget_items`, `trip_tasks`, `bookings`）：
    ```sql
    using (exists (select 1 from trips where trips.id = ... and trips.owner_id = auth.uid()))
    ```
- 保证用户 A 绝对无法读取或覆盖用户 B 的行程数据。

### 4.2 优雅降级 (Demo Fallback)
- 未配置 `NEXT_PUBLIC_SUPABASE_URL` 时，系统自动无感切入 `MemoryTripRepository`；
- 所有核心旅行规划、地图渲染、AI 动作执行与 Today 模式 100% 完整运行，无任何阻塞白屏。
