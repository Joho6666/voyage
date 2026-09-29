import "server-only";

import { NextResponse } from "next/server";
import { getProviderCapabilities } from "@/services/offers/capabilities";
import { configurationPresence } from "@/services/config/local-credentials";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = await configurationPresence();
  return NextResponse.json({
    ok: true,
    capabilities: getProviderCapabilities(),
    // Return presence only. Never expose a key, token, secret or session.
    configuration: {
      amapServer: configured.AMAP_SERVER_KEY,
      amapBrowser: configured.NEXT_PUBLIC_AMAP_KEY,
      meituan: configured.MEITUAN_HT_TOKEN,
      fliggy: configured.FLIGGY_APP_KEY && configured.FLIGGY_APP_SECRET,
      llm: configured.LLM_BASE_URL && configured.LLM_API_KEY,
      supabase: configured.NEXT_PUBLIC_SUPABASE_URL && configured.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      tikhub: configured.TIKHUB_API_KEY,
      // Presence only. RedFox does not participate in the social evidence
      // pipeline (its documented endpoint returns account profiles, not
      // posts); the douyin account-search channel stays available separately.
      redfox: configured.REDFOX_API_KEY,
    },
  }, { headers: { "cache-control": "no-store" } });
}
