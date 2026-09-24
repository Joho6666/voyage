import type { TravelOffer } from "@/types/offers";

// Meituan sometimes returns the train number/time on one Markdown line and
// the linked fare on the next. Join only when the route and response snapshot
// match; a general budget paragraph is never a ticket price.
export function reconcileTrainOffers(offers: TravelOffer[]): TravelOffer[] {
  const consumed = new Set<string>();
  const merged = offers.map((offer) => {
    if (offer.kind !== "train" || offer.priceLabel || !offer.departureTime || !offer.arrivalTime || offer.provider !== "meituan") return offer;
    const direction = offer.title.match(/([\u4e00-\u9fff]{2,})(?:到|返回)([\u4e00-\u9fff]{2,})/);
    if (!direction) return offer;
    const [, origin, destination] = direction;
    const link = offers.find((candidate) =>
      candidate !== offer && !consumed.has(candidate.id) && candidate.kind === "train" &&
      candidate.provider === "meituan" && candidate.fetchedAt === offer.fetchedAt &&
      candidate.rawText === offer.rawText && Boolean(candidate.priceLabel) &&
      candidate.title.includes(`${origin}→${destination}`) &&
      /^火车\s/.test(candidate.title),
    );
    if (!link) return offer;
    consumed.add(link.id);
    return { ...offer, origin, destination, date: link.title.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? offer.date,
      priceLabel: link.priceLabel, bookingUrl: link.bookingUrl ?? offer.bookingUrl };
  });
  return merged.filter((offer) => !consumed.has(offer.id));
}
