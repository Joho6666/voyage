import { randomUUID } from "node:crypto";
import type { OfferKind, OfferProviderLevel, TravelOffer } from "@/types/offers";
import { createFliggyTopClient, FliggyTopError } from "./fliggy-top";

const CITY_AIRPORT_CODES: Record<string, string> = {
  北京: "BJS", 上海: "SHA", 广州: "CAN", 深圳: "SZX", 成都: "CTU", 重庆: "CKG", 贵阳: "KWE", 桂林: "KWL", 西安: "SIA", 昆明: "KMG", 杭州: "HGH", 南京: "NKG", 厦门: "XMN", 武汉: "WUH", 长沙: "CSX", 海口: "HAK", 三亚: "SYX", 郑州: "CGO", 济南: "TNA", 青岛: "TAO", 福州: "FOC", 南宁: "NNG", 乌鲁木齐: "URC", 拉萨: "LXA",
};

export interface FliggyOffersInput {
  origin?: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  travelers: number;
  categories: OfferKind[];
}

export interface FliggyOffersResult {
  offers: TravelOffer[];
  status: OfferProviderLevel;
  warnings: string[];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function flatten(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(flatten)];
}

function offer(input: { kind: OfferKind; title: string; fetchedAt: string; sourceId?: string; imageUrl?: string; priceLabel?: string; availability?: "available" | "unknown"; inventoryLabel?: string; rawJson?: unknown; }): TravelOffer {
  return { id: `fliggy-${input.kind}-${input.sourceId ?? randomUUID()}`, kind: input.kind, provider: "fliggy", title: input.title, city: undefined, date: undefined, imageUrl: input.imageUrl, priceLabel: input.priceLabel, availability: input.availability ?? "unknown", inventoryLabel: input.inventoryLabel, sourceId: input.sourceId, fetchedAt: input.fetchedAt, structured: true, rawJson: input.rawJson };
}

function airportCode(city?: string) {
  if (!city) return undefined;
  const code = city.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) return code;
  return CITY_AIRPORT_CODES[city.trim()];
}

export function resolveAirportCode(city?: string) {
  return airportCode(city);
}

function mapFlights(raw: unknown, input: FliggyOffersInput, fetchedAt: string) {
  return flatten(raw).flatMap((row) => {
    const number = text(row.flight_no ?? row.flightNo ?? row.flight_number ?? row.flightNumber);
    const airline = text(row.airline_name ?? row.airlineName ?? row.airline);
    const title = number ? `${number}${airline ? ` · ${airline}` : ""}` : undefined;
    if (!title) return [];
    const price = text(row.price ?? row.total_price ?? row.lowest_price ?? row.ticket_price);
    const inventoryValue = row.remain_ticket_num ?? row.remaining ?? row.seat_count ?? row.inventory;
    const inventory = typeof inventoryValue === "number" ? inventoryValue : undefined;
    return [offer({ kind: "flight", title, fetchedAt, sourceId: number, priceLabel: price ? `¥${price}` : undefined, availability: inventory !== undefined && inventory > 0 ? "available" : "unknown", inventoryLabel: inventory !== undefined ? `余票 ${inventory}` : "库存未知", rawJson: row })];
  }).slice(0, 30);
}

function mapHotels(raw: unknown, input: FliggyOffersInput, fetchedAt: string) {
  return flatten(raw).flatMap((row) => {
    const title = text(row.hotel_name ?? row.hotelName ?? row.name);
    const id = text(row.hotel_id ?? row.hotelId ?? row.shid ?? row.id);
    const city = text(row.city_name ?? row.cityName ?? row.city);
    if (!title || !id || !city || !city.includes(input.destination)) return [];
    const imageUrl = text(row.image_url ?? row.imageUrl ?? row.pic_url ?? row.cover);
    return [offer({ kind: "hotel", title, fetchedAt, sourceId: id, imageUrl: imageUrl && /^https:\/\//.test(imageUrl) ? imageUrl : undefined, availability: "unknown", inventoryLabel: "房态未知", rawJson: row })];
  }).slice(0, 30);
}

export async function queryFliggyOffers(input: FliggyOffersInput): Promise<FliggyOffersResult> {
  const client = createFliggyTopClient();
  if (!client) return { offers: [], status: "UNAVAILABLE", warnings: ["FLIGGY_APP_KEY / FLIGGY_APP_SECRET 未配置"] };
  const fetchedAt = new Date().toISOString();
  const offers: TravelOffer[] = [];
  const warnings: string[] = [];
  const wantsFlight = input.categories.includes("flight");
  const wantsHotel = input.categories.includes("hotel");

  if (wantsFlight) {
    const departureCityCode = airportCode(input.origin);
    const arrivalCityCode = airportCode(input.destination);
    if (!departureCityCode || !arrivalCityCode || !input.startDate) {
      warnings.push("航班查询需要可识别的机场三字码和出发日期");
    } else {
      try {
        const raw = await client.flightSearch({ departureCityCode, arrivalCityCode, departureDate: input.startDate, returnDate: input.endDate, externalAgentName: process.env.FLIGGY_EXTERNAL_AGENT_NAME?.trim() || "voyage-web" });
        offers.push(...mapFlights(raw, input, fetchedAt));
        if (!offers.some((item) => item.kind === "flight")) warnings.push("飞猪未返回可结构化航班");
      } catch (error) { warnings.push(error instanceof FliggyTopError ? `航班查询失败：${error.message}` : "航班查询失败"); }
    }
  }

  if (wantsHotel) {
    try {
      const raw = await client.feedHotels({ size: 50 });
      const hotels = mapHotels(raw, input, fetchedAt);
      const availability = await Promise.all(hotels.slice(0, 10).map(async (hotel) => {
        if (!input.startDate || !input.endDate || !hotel.sourceId) return hotel;
        try {
          const inventory = await client.availability({ hotelId: hotel.sourceId, checkIn: input.startDate, checkOut: input.endDate, adults: input.travelers });
          const matching = flatten(inventory).find((row) => text(row.hotel_id ?? row.hotelId ?? row.shid) === hotel.sourceId && (row.price !== undefined || row.room_count !== undefined || row.available_rooms !== undefined));
          if (!matching) return hotel;
          const price = text(matching.price ?? matching.sale_price ?? matching.total_price);
          const count = Number(matching.room_count ?? matching.available_rooms ?? matching.inventory);
          return { ...hotel, priceLabel: price ? `¥${price}` : undefined, availability: Number.isFinite(count) ? count > 0 ? "available" as const : "unavailable" as const : "unknown" as const, inventoryLabel: Number.isFinite(count) ? `${count} 间` : "房态未知", checkIn: input.startDate, checkOut: input.endDate, rawJson: matching };
        } catch { return hotel; }
      }));
      offers.push(...availability);
      if (!offers.some((item) => item.kind === "hotel")) warnings.push("飞猪未返回可结构化酒店");
    } catch (error) { warnings.push(error instanceof FliggyTopError ? `酒店查询失败：${error.message}` : "酒店查询失败"); }
  }

  const relevant = offers.length > 0;
  return { offers, status: relevant ? "REAL" : "UNAVAILABLE", warnings };
}
