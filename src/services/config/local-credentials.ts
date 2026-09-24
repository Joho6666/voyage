import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const EDITABLE_KEYS = [
  "AMAP_SERVER_KEY", "NEXT_PUBLIC_AMAP_KEY", "NEXT_PUBLIC_AMAP_SECURITY_CODE",
  "MEITUAN_HT_TOKEN", "FLIGGY_APP_KEY", "FLIGGY_APP_SECRET", "FLIGGY_SESSION",
  "FLIGGY_DISTRIBUTOR", "FLIGGY_API_URL", "FLIGGY_EXTERNAL_AGENT_NAME",
  "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL",
  "EMBEDDING_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL", "EMBEDDING_DIMENSIONS",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export type EditableKey = (typeof EDITABLE_KEYS)[number];
const allowed = new Set<string>(EDITABLE_KEYS);
const configPath = () => path.join(process.cwd(), ".voyage", "local-credentials.json");

export async function readLocalCredentials(): Promise<Partial<Record<EditableKey, string>>> {
  try {
    const data = JSON.parse(await readFile(configPath(), "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(data).filter(([key, value]) => allowed.has(key) && typeof value === "string")) as Partial<Record<EditableKey, string>>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function runtimeConfig(key: EditableKey): Promise<string> {
  const saved = await readLocalCredentials();
  return saved[key] || process.env[key] || "";
}

export function runtimeConfigSync(key: EditableKey): string {
  try {
    const saved = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    if (typeof saved[key] === "string" && saved[key]) return saved[key];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return process.env[key] || "";
}

export async function configurationPresence() {
  const saved = await readLocalCredentials();
  return Object.fromEntries(EDITABLE_KEYS.map((key) => [key, Boolean(saved[key] || process.env[key])])) as Record<EditableKey, boolean>;
}

export async function saveLocalCredential(key: string, value: string) {
  await saveLocalCredentials({ [key]: value });
}

export async function saveLocalCredentials(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) throw new Error("Unknown configuration field");
    if (value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error("Invalid configuration value");
  }
  const current = await readLocalCredentials();
  for (const [key, value] of Object.entries(values)) {
    if (value) current[key as EditableKey] = value;
    else delete current[key as EditableKey];
  }
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(current, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, file);
}
