import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Voyage Travel OS",
    short_name: "Voyage",
    description: "真实数据驱动的可视化旅行工作台",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#0f766e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
