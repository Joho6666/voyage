"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const presets = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1/", models: ["deepseek-chat", "deepseek-reasoner"], url: "https://platform.deepseek.com/api_keys" },
  { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/", models: ["qwen-plus", "qwen-max", "qwen-turbo"], url: "https://bailian.console.aliyun.com/" },
  { id: "moonshot", name: "Moonshot / Kimi", baseUrl: "https://api.moonshot.cn/v1/", models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"], url: "https://platform.moonshot.cn/console/api-keys" },
  { id: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4/", models: ["glm-4-plus", "glm-4-flash"], url: "https://open.bigmodel.cn/usercenter/apikeys" },
  { id: "siliconflow", name: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1/", models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"], url: "https://cloud.siliconflow.cn/account/ak" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1/", models: ["gpt-4.1-mini", "gpt-4.1"], url: "https://platform.openai.com/api-keys" },
  { id: "custom", name: "自定义兼容接口", baseUrl: "", models: [], url: "" },
] as const;

export function LlmProviderEditor({ configured }: { configured: Record<string, boolean> }) {
  const router = useRouter();
  const [provider, setProvider] = useState<string>("deepseek");
  const preset = presets.find((item) => item.id === provider) ?? presets[0];
  const [baseUrl, setBaseUrl] = useState<string>(preset.baseUrl);
  const [model, setModel] = useState<string>(preset.models[0] ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const changeProvider = (id: string) => {
    const next = presets.find((item) => item.id === id) ?? presets[0];
    setProvider(next.id); setBaseUrl(next.baseUrl); setModel(next.models[0] ?? ""); setMessage("");
  };
  const save = async () => {
    if (!baseUrl.trim() || !model.trim() || (!apiKey.trim() && !configured.LLM_API_KEY)) { setMessage("请填写 Base URL、模型名和 API Key"); return; }
    setBusy(true); setMessage("保存中…");
    try {
      const values: Record<string, string> = { LLM_PROVIDER: provider, LLM_BASE_URL: baseUrl.trim(), LLM_MODEL: model.trim() };
      if (apiKey.trim()) values.LLM_API_KEY = apiKey.trim();
      const response = await fetch("/api/voyage/local-credentials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ values }), cache: "no-store" });
      if (!response.ok) throw new Error("save failed");
      setApiKey(""); setMessage("AI 供应商配置已保存"); router.refresh();
    } catch { setMessage("保存失败，请检查本地服务"); }
    finally { setBusy(false); }
  };

  return <div className="mt-4 space-y-3 border-t border-border pt-4">
    <label className="block text-[11px] font-medium">模型供应商
      <select value={provider} onChange={(event) => changeProvider(event.target.value)} className="mt-1 h-9 w-full rounded-[10px] border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
        {presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <label className="block text-[11px] font-medium">Base URL<Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1/" className="mt-1" /></label>
    <label className="block text-[11px] font-medium">模型名称
      <Input list="llm-model-suggestions" value={model} onChange={(event) => setModel(event.target.value)} placeholder="输入供应商支持的模型 ID" className="mt-1" />
      <datalist id="llm-model-suggestions">{preset.models.map((item) => <option key={item} value={item} />)}</datalist>
    </label>
    <label className="block text-[11px] font-medium">API Key · {configured.LLM_API_KEY ? "已配置" : "未配置"}<Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={configured.LLM_API_KEY ? "留空保持现有 Key" : "粘贴 API Key"} className="mt-1" /></label>
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? "保存中" : "保存 AI 配置"}</Button>{preset.url ? <Button asChild size="sm" variant="outline"><a href={preset.url} target="_blank" rel="noopener noreferrer">申请 Key<ExternalLink /></a></Button> : null}</div>
    {message ? <p role="status" className="text-[11px] text-muted-foreground">{message}</p> : null}
    <p className="text-[11px] leading-5 text-muted-foreground">使用 OpenAI-compatible 的 <code>/chat/completions</code> 协议。自定义供应商必须提供公网 HTTP(S) Base URL。</p>
  </div>;
}
