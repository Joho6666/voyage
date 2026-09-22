import { chongqingTrip } from "@/data/demo/chongqing";
import { uid } from "@/lib/utils";
import { recomputeDay } from "@/services/routing";
import { computeTripChangeSet } from "@/services/ai/diff";
import { executeActions } from "@/services/ai/actions/executor";
import type { TravelAction } from "@/services/ai/actions/types";
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
  readonly id: "mock" | "openai" = "mock";

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
    const summary = "Day 2 当前偏赶。建议移除磁器口，把鹅岭二厂留到下午，南滨路提前到傍晚。";
    const actions: TravelAction[] = [
      { type: "REMOVE_ITEM", payload: { itemId: trip.items.find((i) => i.dayId === dayId && i.placeId === "p-ciqikou")?.id ?? "" } },
      { type: "OPTIMIZE_DAY", payload: { dayId } },
    ];
    const { trip: updatedTrip } = executeActions(trip, actions.filter((a) => a.type !== "REMOVE_ITEM" || (a.payload as { itemId: string }).itemId));
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  recommendPlaces(trip: Trip): AgentProposal {
    const summary = "把朝天门码头加到 Day 1 晚饭前，和洪崖洞同江段。";
    const actions: TravelAction[] = [
      { type: "ADD_ITEM", payload: { placeId: "p-chaotianmen", dayId: "day-1", startTime: "17:00", durationMinutes: 60 } },
    ];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  recommendFood(trip: Trip): AgentProposal {
    const summary = "Day 1 晚饭安排珮姐老火锅，距离洪崖洞步行约 11 分钟。";
    const actions: TravelAction[] = [
      { type: "RECOMMEND_FOOD", payload: { dayId: "day-1" } },
    ];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  recommendActivities(trip: Trip): AgentProposal {
    const summary = "Day 2 晚上加入 MAO Livehouse 本地乐队夜。";
    const actions: TravelAction[] = [
      { type: "ADD_ITEM", payload: { placeId: "p-livehouse", dayId: "day-2", startTime: "20:30", durationMinutes: 90 } },
    ];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  reduceBudget(trip: Trip): AgentProposal {
    const summary = "把住宿换成如家商旅，并优化大交通与付费项目，大约省 ¥300。";
    const actions: TravelAction[] = [{ type: "REDUCE_BUDGET", payload: { amount: 300 } }];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  reduceWalking(trip: Trip, dayId?: string): AgentProposal {
    const summary = "长距离步行路段改为地铁或打车，减少山城爬坡体能消耗。";
    const actions: TravelAction[] = [{ type: "REDUCE_WALKING", payload: { dayId } }];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  rainPlan(trip: Trip, dayId?: string): AgentProposal {
    const summary = "下雨方案：将室外露天景点调整为室内三峡博物馆，并减少雨天步行。";
    const actions: TravelAction[] = [{ type: "RAIN_PLAN", payload: { dayId } }];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  delayDay(trip: Trip, dayId: string, minutes: number): AgentProposal {
    const summary = `推迟行程：今天后续所有行程节点往后推迟 ${minutes} 分钟，保证充足休息。`;
    const actions: TravelAction[] = [{ type: "DELAY_DAY", payload: { dayId, minutes } }];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  skipNext(trip: Trip, dayId: string): AgentProposal {
    const summary = "跳过当前站点，自动衔接并重算前往下一站的路线与时间。";
    const actions: TravelAction[] = [{ type: "SKIP_NEXT", payload: { dayId } }];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
    };
  }

  reduceTodayBudget(trip: Trip, dayId: string, amount: number): AgentProposal {
    const summary = `今日节省 ¥${amount}：替换打车为地铁，并调优餐饮支出。`;
    const actions: TravelAction[] = [{ type: "REDUCE_TODAY_BUDGET", payload: { dayId, targetSaveAmount: amount } }];
    const { trip: updatedTrip } = executeActions(trip, actions);
    const changeSet = computeTripChangeSet(trip, updatedTrip, actions, summary);

    return {
      id: uid("prop"),
      summary,
      apply: () => updatedTrip,
      changeSet,
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
    const requestedDayId = text.match(/\[dayId:([^\]]+)\]/)?.[1];
    const currentDayId = trip.days.some((day) => day.id === requestedDayId)
      ? requestedDayId!
      : trip.days[0]?.id ?? "day-1";

    if (text.includes("雨") || text.includes("下雨")) {
      const proposal = this.rainPlan(trip, currentDayId);
      return { id: uid("msg"), role: "assistant", content: proposal.summary, proposal };
    }
    if (text.includes("推迟") || text.includes("延后")) {
      const proposal = this.delayDay(trip, currentDayId, 60);
      return { id: uid("msg"), role: "assistant", content: proposal.summary, proposal };
    }
    if (text.includes("跳过")) {
      const proposal = this.skipNext(trip, currentDayId);
      return { id: uid("msg"), role: "assistant", content: proposal.summary, proposal };
    }
    if (text.includes("省100") || (text.includes("省") && text.includes("100"))) {
      const proposal = this.reduceTodayBudget(trip, currentDayId, 100);
      return { id: uid("msg"), role: "assistant", content: proposal.summary, proposal };
    }
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
      const proposal = this.reduceWalking(trip, currentDayId);
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
      content: "我可以直接改行程。试试：下雨方案、少走路、推迟一小时、今天省100、多安排当地美食。",
    };
  }
}

export const travelAgent: TravelAgent = new MockTravelAgent();
