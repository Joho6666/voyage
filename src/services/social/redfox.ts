import { createSocialAdapter, type SocialRequestTransport } from "./provider";

export function createRedFoxProvider(options: {
  apiKey?: string;
  transport?: SocialRequestTransport;
  now?: () => Date;
} = {}) {
  return createSocialAdapter({
    name: "redfox",
    platforms: ["xiaohongshu", "douyin", "wechat", "wechat_channels"],
    apiKey: options.apiKey ?? process.env.REDFOX_API_KEY,
    transport: options.transport,
    now: options.now,
  });
}
