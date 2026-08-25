import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/api-error";
import { requireAgentApiKey } from "@/lib/public-api";
import { getServerEnvironment } from "@/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /v1/models — OpenAI-compatible model listing.
 *  Proxies the relay's internal model catalog so the list stays in sync. */
export async function GET(request: NextRequest) {
  const authorized = await requireAgentApiKey(request, "chat:write");
  if ("response" in authorized) return authorized.response;

  const environment = getServerEnvironment();
  const secret = environment.RELAY_AGENT_SERVICE_SECRET_CURRENT;
  if (!secret) return apiError("RELAY_NOT_CONFIGURED", 503, "Relay 服务密钥未配置");

  try {
    const response = await fetch(`${environment.RELAY_AGENT_URL.replace(/\/$/, "")}/api/internal/agent/models`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: authorized.key.userId }),
      cache: "no-store",
    });
    if (!response.ok) return apiError("RELAY_ERROR", response.status, "Relay 返回错误");
    const body = await response.json() as { modelSelectorData?: { featured?: { id: string; name: string; description?: string }[]; channels?: { id: string; models: { id: string; name: string }[] }[] } };
    const data = body.modelSelectorData;
    if (!data) return apiError("RELAY_ERROR", 502, "Relay 未返回模型数据");

    // Flatten into OpenAI /v1/models format
    const seen = new Set<string>();
    const models: Array<{ id: string; object: "model"; created: number; owned_by: string }> = [];
    const created = Math.floor(Date.now() / 1000);

    for (const model of data.featured ?? []) {
      if (!seen.has(model.id)) {
        seen.add(model.id);
        models.push({ id: model.id, object: "model", created, owned_by: "relay" });
      }
    }
    for (const channel of data.channels ?? []) {
      for (const model of channel.models) {
        if (!seen.has(model.id)) {
          seen.add(model.id);
          models.push({ id: model.id, object: "model", created, owned_by: channel.id });
        }
      }
    }

    return NextResponse.json({ object: "list", data: models }, { headers: { "cache-control": "no-store" } });
  } catch {
    return apiError("RELAY_UNREACHABLE", 502, "无法连接 Relay 服务");
  }
}
