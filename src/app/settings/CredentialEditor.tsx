"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CredentialEditor({ fields, configured }: { fields: readonly string[]; configured: Record<string, boolean> }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});
  const save = async (key: string, value: string) => {
    if (!value || busy) return;
    setBusy(key);
    setMessage((current) => ({ ...current, [key]: "保存中…" }));
    try {
      const response = await fetch("/api/voyage/local-credentials", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }), cache: "no-store",
      });
      if (!response.ok) throw new Error("保存失败");
      setValues((current) => ({ ...current, [key]: "" }));
      setMessage((current) => ({ ...current, [key]: "已保存到本机 JSON" }));
      router.refresh();
    } catch { setMessage((current) => ({ ...current, [key]: "保存失败，请检查本地服务" })); }
    finally { setBusy(null); }
  };
  return <div className="mt-4 space-y-3 border-t border-border pt-4">
    <p className="text-xs text-muted-foreground">在此填入新值，离开输入框后自动保存；已保存的值不会回显。</p>
    {fields.map((key) => <div key={key} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="min-w-0 text-[11px] font-medium"><span className="break-all">{key} {configured[key] ? "· 已配置" : "· 未配置"}</span>
        <Input type={/URL|MODEL|DISTRIBUTOR|AGENT_NAME/.test(key) ? "text" : "password"} autoComplete="off" value={values[key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => void save(key, values[key] ?? "")} placeholder={configured[key] ? "留空保持现有配置" : "粘贴新值"} className="mt-1" />
      </label>
      <Button size="sm" variant="outline" disabled={!values[key] || busy !== null} onClick={() => void save(key, values[key] ?? "")}>{busy === key ? "保存中" : "保存"}</Button>
      {message[key] ? <p role="status" className="text-[11px] text-muted-foreground sm:col-span-2">{message[key]}</p> : null}
    </div>)}
  </div>;
}
