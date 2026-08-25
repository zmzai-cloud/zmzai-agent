/**
 * iPaaS 连接器统一接口定义
 */

export const IPAAS_PLATFORMS = ["feishu", "email", "webhook"] as const;
export type IpaasPlatform = (typeof IPAAS_PLATFORMS)[number];

export const IPAAS_CONNECTOR_STATUSES = ["active", "paused"] as const;
export type IpaasConnectorStatus = (typeof IPAAS_CONNECTOR_STATUSES)[number];

export interface InboundMessage {
  platform: IpaasPlatform;
  messageId: string;
  actor: string;
  channel: string;
  text: string;
  replyContext?: unknown;
}

export interface OutboundMessage {
  to: string;
  text: string;
  richContent?: unknown;
}

export interface InboundRequest {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  connectorId: string;
  credentials: Record<string, string>;
}

export interface DeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ConnectorConfig {
  connectorId: string;
  workspaceId: string;
  platform: IpaasPlatform;
  name: string;
  credentials: Record<string, string>;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  linkedAutomationId: string | null;
  status: IpaasConnectorStatus;
}

/** 连接器接口 — 每个平台实现 */
export interface Connector {
  readonly platform: IpaasPlatform;
  /** 入站：验证平台签名，返回标准化消息或 null */
  validateInbound(request: InboundRequest): unknown;
  /** 出站：发送消息到平台 */
  sendOutbound(config: ConnectorConfig, message: OutboundMessage): Promise<DeliveryResult>;
}
