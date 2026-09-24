export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly isOperational: boolean;

  constructor(message: string, code = "APP_ERROR", statusCode = 500) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = true;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProviderError extends AppError {
  readonly provider: string;

  constructor(message: string, provider: string, code = "PROVIDER_UNAVAILABLE", statusCode = 502) {
    super(`${provider} 服务暂时不可用: ${message}`, code, statusCode);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

export class AgentError extends AppError {
  constructor(message: string, code = "AGENT_PLAN_FAILED", statusCode = 422) {
    super(message, code, statusCode);
    this.name = "AgentError";
  }
}

export function getUserFriendlyErrorMessage(error: unknown): string {
  if (!error) return "发生未知错误，请稍后重试";
  if (typeof error === "string") return error;
  if (error instanceof ProviderError) {
    return `${error.provider} 外部服务响应超时或未配置，已自动为您平滑降级。`;
  }
  if (error instanceof AgentError) {
    return error.message || "AI 规划遇到阻碍，已切换为本地备选方案。";
  }
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    // Avoid leaking stack or raw api key strings
    if (error.message.includes("key") || error.message.includes("token")) {
      return "服务接口凭据校验异常，请检查配置。";
    }
    return error.message;
  }
  return "系统处理异常，请刷新重试";
}
