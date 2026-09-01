# Voyage · Travel OS

AI 旅行操作系统 MVP。独立 Next.js 应用，端口 **3002**，不占用 C-Embedded Agent (`:3000`) 或 UniGateway (`:3001`)。

品牌名称集中在 `src/lib/brand.ts`。

## 启动

```bash
cd voyage
npm install
npm run dev
```

打开 [http://localhost:3002](http://localhost:3002)。无需任何 API Key。

内置 Demo：重庆 3 天 2 夜 → `/trip/chongqing-2026`

## 文档

- `docs/TRAVEL_OS_ARCHITECTURE.md`
- `docs/TRAVEL_OS_DESIGN_SYSTEM.md`
- `docs/MVP_PLAN.md`
