import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

/** 服务间密钥（workos → agent）：非空时必须 ≥32 字符。 */
const serviceSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(32).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  MONGODB_URI: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("muzhi_session"),
  SESSION_COOKIE_DOMAIN: optionalString,
  RELAY_AGENT_URL: z.string().url().default("https://m.zmzai.cloud"),
  RELAY_AGENT_SERVICE_SECRET_CURRENT: optionalString,
  RELAY_AGENT_SERVICE_SECRET_PREVIOUS: optionalString,
  SANDBOX_AGENT_URL: z.string().url().default("https://z.zmzai.cloud"),
  SANDBOX_AGENT_SERVICE_SECRET_CURRENT: optionalString,
  AUTOMATION_SCHEDULER_SECRET: optionalString,
  // workos（i.zmzai.cloud）服务间拉取任务/智能体摘要用的密钥，双侧同名。
  WORKOS_SERVICE_SECRET_CURRENT: serviceSecret,
  WORKOS_SERVICE_SECRET_PREVIOUS: serviceSecret,
  GITHUB_OAUTH_CLIENT_ID: optionalString,
  GITHUB_OAUTH_CLIENT_SECRET: optionalString,
  // hindsight 长期记忆服务（HK 同机内网直连；未配 URL 或显式 false 时全链路 noop）。
  HINDSIGHT_API_URL: optionalString,
  HINDSIGHT_ENABLED: optionalString,
  // 可见 hindsight UI SSH 隧道指引的白名单（逗号分隔 userId）。
  HINDSIGHT_ADMIN_USER_IDS: optionalString,
  // 遥测：usage/span 事件推送到 zmzai-billing /api/v1/ingest。未配置时静默跳过（不阻塞主流程）。
  BILLING_INGEST_URL: optionalString,
  BILLING_INGEST_KEY: optionalString,
});

export type ServerEnvironment = z.infer<typeof environmentSchema>;

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= environmentSchema.parse(process.env);
  return cachedEnvironment;
}

export function resetServerEnvironmentForTest(): void {
  cachedEnvironment = undefined;
}
