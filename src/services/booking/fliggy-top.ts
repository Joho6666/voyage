import { createHash, createHmac } from "node:crypto";

/**
 * Minimal server-side client for the Fliggy/Taobao TOP protocol.
 *
 * This module must only be imported from a server boundary. AppSecret and
 * session are never exposed to the browser. The hotel APIs use different
 * partner permissions, so the low-level client is deliberately kept generic
 * and the three documented distribution calls below are explicit.
 */

const DEFAULT_ENDPOINT = "https://eco.taobao.com/router/rest";

type TopScalar = string | number | boolean;
type TopValue = TopScalar | Record<string, unknown> | Array<unknown>;

export interface FliggyTopConfig {
  appKey: string;
  appSecret: string;
  session?: string;
  endpoint?: string;
  distributor?: string;
}

export interface FliggyFeedQuery {
  afterModifiedTime?: string;
  language?: "zh_CN" | "en_US";
  distributor?: string;
  page?: number;
  size?: number;
}

export interface FliggyAvailabilityQuery {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  childrenAges?: number[];
  language?: "zh_CN" | "en_US";
  distributor?: string;
}

export interface FliggyFlightSearchQuery {
  departureCityCode: string;
  arrivalCityCode: string;
  departureDate: string;
  tripType?: 1 | 2;
  cabinClass?: "ALL_CABIN" | "Y" | "FC" | "F" | "C";
  externalAgentName: string;
  searchMode?: 0 | 2;
  returnDate?: string;
  hasChild?: boolean;
  hasInfant?: boolean;
}

export class FliggyTopError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "FliggyTopError";
  }
}

export function getFliggyTopConfig(env: NodeJS.ProcessEnv = process.env): FliggyTopConfig | null {
  const appKey = env.FLIGGY_APP_KEY?.trim();
  const appSecret = env.FLIGGY_APP_SECRET?.trim();
  if (!appKey || !appSecret) return null;

  return {
    appKey,
    appSecret,
    session: env.FLIGGY_SESSION?.trim() || undefined,
    endpoint: env.FLIGGY_API_URL?.trim() || DEFAULT_ENDPOINT,
    distributor: env.FLIGGY_DISTRIBUTOR?.trim() || undefined,
  };
}

function formatGmt8Timestamp(date = new Date()): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 19).replace("T", " ");
}

function stringifyValue(value: TopValue): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function signTopParams(
  params: Record<string, string>,
  secret: string,
  method: "hmac" | "md5" = "hmac",
): string {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");

  if (method === "md5") {
    return createHash("md5").update(`${secret}${canonical}${secret}`, "utf8").digest("hex").toUpperCase();
  }

  return createHmac("md5", secret).update(canonical, "utf8").digest("hex").toUpperCase();
}

export class FliggyTopClient {
  private readonly config: Required<Pick<FliggyTopConfig, "appKey" | "appSecret" | "endpoint">> &
    Pick<FliggyTopConfig, "session" | "distributor">;

  constructor(config: FliggyTopConfig) {
    this.config = {
      appKey: config.appKey,
      appSecret: config.appSecret,
      endpoint: config.endpoint || DEFAULT_ENDPOINT,
      session: config.session,
      distributor: config.distributor,
    };
  }

  async call<T = unknown>(method: string, params: Record<string, TopValue> = {}): Promise<T> {
    const unsigned: Record<string, string> = {
      app_key: this.config.appKey,
      format: "json",
      method,
      sign_method: "hmac",
      timestamp: formatGmt8Timestamp(),
      v: "2.0",
      ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, stringifyValue(value)])),
    };

    if (this.config.session) unsigned.session = this.config.session;
    const body = new URLSearchParams({ ...unsigned, sign: signTopParams(unsigned, this.config.appSecret) });

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new FliggyTopError(error instanceof Error ? error.message : "Fliggy request failed");
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new FliggyTopError(`Fliggy HTTP ${response.status}`, String(response.status), payload);
    }
    const errorPayload = payload?.error_response;
    if (errorPayload && typeof errorPayload === "object" && errorPayload !== null) {
      const error = errorPayload as { msg?: unknown; code?: unknown };
      throw new FliggyTopError(
        typeof error.msg === "string" ? error.msg : "Fliggy API rejected the request",
        typeof error.code === "string" ? error.code : undefined,
        errorPayload,
      );
    }
    return payload as T;
  }

  /** taobao.xhotel.distribution.feed.hotel.query: static hotel feed. */
  feedHotels(query: FliggyFeedQuery = {}) {
    return this.call("taobao.xhotel.distribution.feed.hotel.query", {
      feed_hotel_query: {
        after_modified_time: query.afterModifiedTime,
        language: query.language || "zh_CN",
        distributor: query.distributor || this.config.distributor,
      },
      page_request: {
        page: query.page || 1,
        size: Math.min(query.size || 50, 50),
      },
    });
  }

  /** taobao.xhotel.distribution.foundation.hotel.query: static info by shid. */
  hotelInfo(shids: number[], language: "zh_CN" | "en_US" = "zh_CN") {
    if (shids.length === 0) throw new FliggyTopError("At least one shid is required", "INVALID_SHID_LIST");
    return this.call("taobao.xhotel.distribution.foundation.hotel.query", {
      hotel_static_info_top_param: { language, shid_list: shids },
    });
  }

  /** taobao.xhotel.distribution.ari.availability: date-specific rates and inventory. */
  availability(query: FliggyAvailabilityQuery) {
    return this.call("taobao.xhotel.distribution.ari.availability", {
      availability_query: {
        check_in: query.checkIn,
        check_out: query.checkOut,
        adults: query.adults,
        children: query.children || 0,
        children_ages: query.childrenAges,
        hotel_id: query.hotelId,
        language: query.language || "zh_CN",
        distributor: query.distributor || this.config.distributor,
      },
    });
  }

  /** alitrip.flight.service.search: flight quotation/search. */
  flightSearch(query: FliggyFlightSearchQuery) {
    const od = {
      dep_city_code: query.departureCityCode,
      arr_city_code: query.arrivalCityCode,
      dep_date: query.departureDate,
    };
    if (query.returnDate) {
      return this.call("alitrip.flight.service.search", {
        search_flight_info_req: {
          cabin_class: query.cabinClass || "ALL_CABIN",
          search_od_info_list: [od, {
            dep_city_code: query.arrivalCityCode,
            arr_city_code: query.departureCityCode,
            dep_date: query.returnDate,
          }],
          external_agent_name: query.externalAgentName,
          search_mode: query.searchMode ?? 2,
          trip_type: query.tripType ?? 2,
          has_child: query.hasChild ?? false,
          has_infant: query.hasInfant ?? false,
        },
      });
    }

    return this.call("alitrip.flight.service.search", {
      search_flight_info_req: {
        cabin_class: query.cabinClass || "ALL_CABIN",
        search_od_info_list: [od],
        external_agent_name: query.externalAgentName,
        search_mode: query.searchMode ?? 2,
        trip_type: query.tripType ?? 1,
        has_child: query.hasChild ?? false,
        has_infant: query.hasInfant ?? false,
      },
    });
  }
}

export function createFliggyTopClient(): FliggyTopClient | null {
  const config = getFliggyTopConfig();
  return config ? new FliggyTopClient(config) : null;
}
