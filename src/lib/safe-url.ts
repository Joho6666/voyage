function isLoopbackHost(host: string) {
  const h = host.toLowerCase();
  if (h === "localhost") return true;
  if (h === "0.0.0.0") return true;
  if (h.endsWith(".local")) return true;
  if (h === "ip6-localhost") return true;
  return false;
}

function isPrivateIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function assertPublicHttpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }
  const host = url.hostname.toLowerCase();
  if (isLoopbackHost(host) || isPrivateIpv4(host)) {
    throw new Error("Private or reserved hosts are not allowed");
  }
  return url;
}

/**
 * Stricter variant for URLs that come from USER INPUT and get fetched
 * server-side (e.g. a pasted 小红书 short link). assertPublicHttpUrl above
 * guards admin-set config values and must stay lenient enough for those
 * (a self-hosted LLM endpoint on a reserved range is the operator's call);
 * this one adds the encodings an attacker would actually reach for.
 */
function isReservedIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  // Reject any dotted form carrying a leading zero ("0177.0.0.1"): some
  // resolvers read those as octal, which would smuggle in a loopback address.
  if (parts.some((part) => part.length > 1 && part.startsWith("0"))) return true;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0/24 + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18/15
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isIpLiteralForm(host: string) {
  // Whole-host numeric or hex forms resolve to an IPv4 address without any
  // dot ("http://2130706433/", "http://0x7f000001/").
  return /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host);
}

function isBlockedIpv6Literal(host: string) {
  // url.hostname keeps the brackets for IPv6 literals.
  if (!host.startsWith("[")) return false;
  const inner = host.slice(1, -1).toLowerCase();
  if (inner === "::1" || inner === "::") return true;
  const first = inner.split(":").find((group) => group.length > 0) ?? "";
  const head = parseInt(first, 16);
  if (!Number.isFinite(head)) return true;
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv6 literal that is none of the above: not a platform domain, and the
  // caller's whitelist requires one — refuse rather than reason about it.
  return true;
}

export function assertPublicFetchUrl(raw: string) {
  const url = assertPublicHttpUrl(raw);
  const host = url.hostname.toLowerCase();
  if (isIpLiteralForm(host) || isReservedIpv4(host) || isBlockedIpv6Literal(host)) {
    throw new Error("Private or reserved hosts are not allowed");
  }
  if (host === "255.255.255.255") throw new Error("Private or reserved hosts are not allowed");
  return url;
}
