import { createSocialAdapter, type SocialRequestTransport } from "./provider";

export function createTikHubProvider(options: {
  apiKey?: string;
  transport?: SocialRequestTransport;
  now?: () => Date;
} = {}) {
  return createSocialAdapter({
    name: "tikhub",
    platforms: ["tiktok", "instagram", "youtube", "x", "douyin"],
    apiKey: options.apiKey ?? process.env.TIKHUB_API_KEY,
    transport: options.transport,
    now: options.now,
  });
}
