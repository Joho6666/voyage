import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlanningStatusCard } from "@/components/planning/PlanningStatusCard";

afterEach(cleanup);

describe("PlanningStatusCard", () => {
  it("discloses the rule-planner takeover when the model falls back", () => {
    render(<PlanningStatusCard status={{ state: "fallback", reason: "模型超时" }} />);
    expect(screen.getByRole("region", { name: "规划服务状态" })).toHaveTextContent("规则规划接管");
    expect(screen.getByText("模型暂时没有参与，本次会使用确定性规则完成路线。")).toBeInTheDocument();
    expect(screen.getByText("模型超时")).toBeInTheDocument();
  });

  it("shows the ready state with provider and model chips", () => {
    render(<PlanningStatusCard status={{ state: "ready", provider: "ark", model: "doubao-pro" }} />);
    expect(screen.getByText("模型协作中")).toBeInTheDocument();
    expect(screen.getByText("ark · doubao-pro")).toBeInTheDocument();
  });

  it("keeps the unavailable state honest about no credentials", () => {
    render(<PlanningStatusCard status={{ state: "unavailable" }} />);
    expect(screen.getByText("尚未启用模型服务，仍可继续规划；不会在浏览器暴露任何凭据。")).toBeInTheDocument();
  });

  it("hides the description in compact mode", () => {
    render(<PlanningStatusCard status={{ state: "ready" }} compact />);
    expect(screen.queryByText("服务端模型正在帮你整理偏好，路线仍会经过旅行规则校验。")).not.toBeInTheDocument();
  });
});
