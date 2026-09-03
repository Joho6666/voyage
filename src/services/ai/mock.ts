import { chongqingTrip } from "@/data/demo/chongqing";
import { uid } from "@/lib/utils";
import { recomputeDay, recomputeTrip } from "@/services/routing";
import type { Trip } from "@/types/travel";
import type {
  AgentMessage,
  AgentProposal,
  CreateTripInput,
  GenerationStep,
  TravelAgent,
} from "./types";

function cloneDemo(input: CreateTripInput): Trip {
  const trip = structuredClone(chongqingTrip);
  trip.prompt = input.prompt || trip.prompt;
  if (input.origin) trip.origin = input.origin;
  if (input.destination) trip.destination = input.destination;
  if (input.startDate) trip.startDate = input.startDate;
  if (input.endDate) trip.endDate = input.endDate;
  if (input.travelers) trip.travelers = input.travelers;
  if (input.budget) trip.budget = input.budget;
  if (input.vibes?.length) trip.vibe = input.vibes;
  return trip;
}

export class MockTravelAgent implements TravelAgent {
  readonly id: TravelAgent["id"] = "mock";

  generationSteps(): GenerationStep[] {
    return [
      { id: "pref", label: "分析旅行偏好", status: "pending" },
      { id: "poi", label: "查询热门景点", status: "pending" },
      { id: "food", label: "寻找当地美食", status: "pending" },
      { id: "stay", label: "规划住宿区域", status: "pending" },
      { id: "day2", label: "正在优化 Day 2 路线", status: "pending" },
      { id: "act", label: "搜索当地活动", status: "pending" },
    ];
  }

  async createTrip(input: CreateTripInput): Promise<Trip> {
    return cloneDemo(input);
  }

  optimizeDay(trip: Trip, dayId: string): AgentProposal {
    return {
      id: uid("prop"),
      summary:
        "Day 2 当前偏赶。建议移除磁器口，把鹅岭二厂留到下午，南滨路提前到傍晚。",
      apply: (current) => {
        const next = {
          ...current,
          items: current.items.filter((item) => !(item.dayId === dayId && item.placeId === "p-ciqikou")),
        };
        return recomputeDay(next, dayId);
      },
    };
  }

  recommendPlaces(trip: Trip): AgentProposal {
    const already = trip.items.some((i) => i.placeId === "p-chaotianmen");
    return {
      id: uid("prop"),
      summary: already
        ? "朝天门已经在行程里。可以把它挪到 Day 1 晚饭前，和洪崖洞同江段。"
        : "把朝天门码头加到 Day 1 晚饭前，和洪崖洞同江段。",
      apply: (current) => this.addItem(current, "p-chaotianmen", "day-1"),
    };
  }

  recommendFood(trip: Trip): AgentProposal {
    const already = trip.items.some((i) => i.placeId === "p-hotpot-peijie");
    return {
      id: uid("prop"),
      summary: already
        ? "珮姐老火锅已在行程中，建议作为 Day 1 晚饭，距离洪崖洞步行约 11 分钟。"
        : "Day 1 晚饭改去珮姐老火锅，距离洪崖洞步行约 11 分钟。",
      apply: (current) => this.addItem(current, "p-hotpot-peijie", "day-1"),
    };
  }

  recommendActivities(trip: Trip): AgentProposal {
    const already = trip.items.some((i) => i.placeId === "p-livehouse");
    return {
      id: uid("prop"),
      summary: already
        ? "MAO Livehouse 已在行程中，适合作为 Day 2 晚上收尾。"
        : "Day 2 晚上加入 MAO Livehouse 本地乐队夜。",
      apply: (current) => this.addItem(current, "p-livehouse", "day-2"),
    };
  }

  reduceBudget(trip: Trip): AgentProposal {
    const nextSpend = Math.max(1600, trip.estimatedSpend - 300);
    return {
      id: uid("prop"),
      summary: "把住宿换成如家商旅，并去掉付费索道，大约省 ¥300。",
      apply: (current) => ({ ...current, estimatedSpend: nextSpend }),
    };
  }

  reduceWalking(trip: Trip): AgentProposal {
    const walkHeavy = trip.items.some((item) => item.placeId === "p-shancheng" && item.duration > 40);
    return {
      id: uid("prop"),
      summary: walkHeavy
        ? "山城步道改短走，用地铁把礼堂到解放碑连起来，减少爬坡。"
        : "步行已经压过一轮。如果还累，可以把磁器口挪走。",
      apply: (current) => recomputeTrip({
        ...current,
        items: current.items.map((item) =>
          item.placeId === "p-shancheng" ? { ...item, duration: 40 } : item,
        ),
      }),
    };
  }

  moveItem(trip: Trip, itemId: string, toDayId: string): Trip {
    const item = trip.items.find((i) => i.id === itemId);
    if (!item) return trip;
    const fromDay = item.dayId;
    const order = trip.items.filter((i) => i.dayId === toDayId).length;
    const moved = trip.items.map((i) => (i.id === itemId ? { ...i, dayId: toDayId, order } : i));
    return recomputeDay(recomputeDay({ ...trip, items: moved }, fromDay), toDayId);
  }

  removeItem(trip: Trip, itemId: string): Trip {
    const item = trip.items.find((i) => i.id === itemId);
    if (!item) return trip;
    return recomputeDay({ ...trip, items: trip.items.filter((i) => i.id !== itemId) }, item.dayId);
  }

  addItem(trip: Trip, placeId: string, dayId: string): Trip {
    if (trip.items.some((i) => i.dayId === dayId && i.placeId === placeId)) return trip;
    const place = trip.places.find((p) => p.id === placeId);
    if (!place) return trip;
    const order = trip.items.filter((i) => i.dayId === dayId).length;
    const type =
      place.category === "food" || place.category === "cafe"
        ? "food"
        : place.category === "hotel"
          ? "hotel"
          : place.category === "activity"
            ? "activity"
            : place.category === "transport"
              ? "transport"
              : "place";
    const next: Trip = {
      ...trip,
      items: [
        ...trip.items,
        {
          id: uid("it"),
          dayId,
          type,
          placeId,
          startTime: "18:00",
          duration: place.stayMinutes || 60,
          order,
          status: "planned",
        },
      ],
    };
    return recomputeDay(next, dayId);
  }

  async chat(trip: Trip, message: string): Promise<AgentMessage> {
    const text = message.trim();
    if (text.includes("赶") || text.toLowerCase().includes("day 2")) {
      const proposal = this.optimizeDay(trip, "day-2");
      return {
        id: uid("msg"),
        role: "assistant",
        content: `Day 2 当前 ${trip.items.filter((i) => i.dayId === "day-2").length} 个地点。${proposal.summary}`,
        proposal,
      };
    }
    if (text.includes("省") || text.includes("预算")) {
      const proposal = this.reduceBudget(trip);
      return { id: uid("msg"), role: "assistant", content: proposal.summary, proposal };
    }
    if (text.includes("走") || text.includes("累")) {
      const proposal = this.reduceWalking(trip);
      return { id: uid("msg"), role: "assistant", content: proposal.summary, proposal };
    }
    if (text.includes("美食") || text.includes("吃")) {
      const proposal = this.recommendFood(trip);
      return { id: uid("msg"), role: "assistant", content: proposal.summary, proposal };
    }
    if (text.includes("活动") || text.includes("夜")) {
      const proposal = this.recommendActivities(trip);
      return { id: uid("msg"), role: "assistant", content: proposal.summary, proposal };
    }
    return {
      id: uid("msg"),
      role: "assistant",
      content: "我可以直接改行程。试试：Day 2 太赶了、帮我省 ¥300、减少走路、多安排当地美食。",
    };
  }
}

export const travelAgent: TravelAgent = new MockTravelAgent();
