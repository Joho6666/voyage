import { ExternalLink, RefreshCw } from "lucide-react";
import { AppFrame } from "@/components/layout/AppFrame";
import { Button } from "@/components/ui/button";
import { configurationPresence } from "@/services/config/local-credentials";
import { CredentialEditor } from "./CredentialEditor";
import { LlmProviderEditor } from "./LlmProviderEditor";

type Config = Record<"amapServer" | "amapBrowser" | "meituan" | "fliggy" | "llm" | "supabase", boolean>;
export const dynamic = "force-dynamic";

const providers = [
  { name: "高德地图", usage: "真实 POI、路线、天气、地图", keys: ["AMAP_SERVER_KEY", "NEXT_PUBLIC_AMAP_KEY", "NEXT_PUBLIC_AMAP_SECURITY_CODE"], fields: ["amapServer", "amapBrowser"], url: "https://console.amap.com/dev/key/app", link: "高德开放平台" },
  { name: "美团 Travel Skill", usage: "酒店、车票、门票、美食和优惠推荐", keys: ["MEITUAN_HT_TOKEN"], fields: ["meituan"], url: "https://open.meituan.com/", link: "美团开放平台" },
  { name: "飞猪 TOP", usage: "酒店房态与航班（需商家/分销权限）", keys: ["FLIGGY_APP_KEY", "FLIGGY_APP_SECRET", "FLIGGY_SESSION", "FLIGGY_DISTRIBUTOR"], fields: ["fliggy"], url: "https://open.alitrip.com/", link: "飞猪开放平台" },
  { name: "AI 模型（可选）", usage: "DeepSeek、通义、Kimi、GLM、硅基流动、OpenAI 或自定义兼容接口", keys: [] as string[], fields: ["llm"], url: "https://platform.openai.com/api-keys", link: "AI 供应商文档" },
  { name: "Supabase（可选）", usage: "用户认证及云端数据；Guest 可使用本地工作区", keys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"], fields: ["supabase"], url: "https://supabase.com/dashboard", link: "Supabase 控制台" },
] as const;

export default async function SettingsPage() {
  const editable = process.env.VOYAGE_LOCAL_SETTINGS_ENABLED === "1" && !process.env.VERCEL && !process.env.CI;
  const configured = await configurationPresence();
  const config: Config = {
    amapServer: configured.AMAP_SERVER_KEY,
    amapBrowser: configured.NEXT_PUBLIC_AMAP_KEY,
    meituan: configured.MEITUAN_HT_TOKEN,
    fliggy: configured.FLIGGY_APP_KEY && configured.FLIGGY_APP_SECRET,
    llm: configured.LLM_BASE_URL && configured.LLM_API_KEY,
    supabase: configured.NEXT_PUBLIC_SUPABASE_URL && configured.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  return (
    <AppFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div><h1 className="text-3xl font-medium">API 与数据源设置</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">查看服务端配置状态与官网申请入口。这里不显示或接收密钥，避免把敏感凭据暴露给浏览器。</p></div>
          <Button asChild size="sm" variant="outline"><a href="/settings"><RefreshCw />重新检查</a></Button>
        </header>
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {providers.map((provider) => {
            const ready = provider.fields.every((field) => config[field]);
            return <article key={provider.name} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{provider.name}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{provider.usage}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${ready ? "bg-emerald-50 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>{ready ? "已配置" : "未配置"}</span></div>
              <div className="mt-4 flex flex-wrap gap-1.5">{provider.keys.map((key) => <code key={key} className="rounded-md bg-secondary px-2 py-1 text-[11px]">{key}</code>)}</div>
              {editable && provider.name === "AI 模型（可选）" ? <LlmProviderEditor configured={configured} /> : null}
              {editable && provider.name !== "AI 模型（可选）" ? <CredentialEditor fields={provider.keys} configured={configured} /> : null}
              <Button asChild size="sm" variant="outline" className="mt-4"><a href={provider.url} target="_blank" rel="noopener noreferrer">{provider.link}<ExternalLink /></a></Button>
            </article>;
          })}
        </section>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">本地编辑模式下，配置自动保存到 .voyage/local-credentials.json（Git 已忽略）。高德服务端、美团、飞猪及 AI 服务端调用会读取新值；浏览器地图 Key 与 Supabase 公共配置需要重新构建并重启网页服务才能生效。“已配置”不保证供应商权限、配额或网络健康。飞猪须另外申请分销权限；12306 查询链接不是实时 API。</p>
      </main>
    </AppFrame>
  );
}
