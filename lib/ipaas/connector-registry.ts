/**
 * 连接器注册表
 */

import type { Connector, IpaasPlatform } from "./types";
import { feishuConnector } from "./feishu-adapter";
import { emailConnector } from "./email-connector";
import { webhookConnector } from "./webhook-connector";

const registry = new Map<IpaasPlatform, Connector>();
registry.set("feishu", feishuConnector);
registry.set("email", emailConnector);
registry.set("webhook", webhookConnector);

export function getConnector(platform: IpaasPlatform): Connector | undefined {
  return registry.get(platform);
}

export function getRegisteredPlatforms(): IpaasPlatform[] {
  return Array.from(registry.keys());
}

export function isPlatformRegistered(platform: string): platform is IpaasPlatform {
  return registry.has(platform as IpaasPlatform);
}
