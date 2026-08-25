import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { z } from "zod";

import { getServerEnvironment } from "@/config/env";
import { apiError } from "@/lib/api-error";
import { relayAgentContractVersion } from "@/lib/internal-contracts";
import { requireAgentApiKey } from "@/lib/public-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.unknown(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});

const bodySchema = z.object({
  model: z.string().trim().min(1).max(128),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  n: z.number().int().min(1).max(1).optional(),
}).strict();

/** POST /v1/chat/completions — OpenAI-compatible chat completion.
 *  Proxies the relay's internal agent chat endpoint, translating the request
 *  into the relay's wire format and forwarding the response verbatim (the
 *  relay already emits standard OpenAI SSE chunks). */
export async function POST(request: NextRequest) {
  const authorized = await requireAgentApiKey(request, "chat:write");
  if ("response" in authorized) return authorized.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "请求格式不正确");

  const environment = getServerEnvironment();
  const secret = environment.RELAY_AGENT_SERVICE_SECRET_CURRENT;
  if (!secret) return apiError("RELAY_NOT_CONFIGURED", 503, "Relay 服务密钥未配置");

  // Convert OpenAI messages → relay format (relay expects the same OpenAI wire
  // format internally, so this is mostly a pass-through with system prompt
  // extraction).
  const relayMessages = parsed.data.messages.map((msg) => {
    if (msg.role === "system") return { role: "system", content: typeof msg.content === "string" ? msg.content : String(msg.content ?? "") };
    if (msg.role === "tool") return { role: "tool", content: typeof msg.content === "string" ? msg.content : String(msg.content ?? ""), tool_call_id: msg.tool_call_id ?? "" };
    return { role: msg.role, content: msg.content };
  });

  const requestId = `chat_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const relayBody: Record<string, unknown> = {
    userId: authorized.key.userId,
    taskRunId: requestId,
    requestId,
    model: parsed.data.model,
    messages: relayMessages,
    stream: parsed.data.stream,
    tool_choice: "none",
  };
  if (parsed.data.max_tokens) relayBody.max_tokens = parsed.data.max_tokens;

  try {
    const relayResponse = await fetch(`${environment.RELAY_AGENT_URL.replace(/\/$/, "")}/api/internal/agent/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "x-zmzai-contract-version": relayAgentContractVersion,
      },
      body: JSON.stringify(relayBody),
      cache: "no-store",
    });

    if (!relayResponse.ok || !relayResponse.body) {
      const errorBody = await relayResponse.text().catch(() => "Relay error");
      return apiError("RELAY_ERROR", relayResponse.status, typeof errorBody === "string" ? errorBody : "Relay 返回错误");
    }

    // Streaming: forward the SSE stream verbatim (relay uses standard OpenAI
    // SSE format: "data: {...}\n\n" with "data: [DONE]" terminator).
    if (parsed.data.stream) {
      const stream = new ReadableStream({
        async start(controller) {
          const reader = relayResponse.body!.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "connection": "keep-alive",
        },
      });
    }

    // Non-streaming: collect SSE chunks and assemble an OpenAI-format response.
    const reader = relayResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let finishReason = "stop";
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (chunk.choices?.[0]?.delta?.content) fullContent += chunk.choices[0].delta.content;
          if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0;
            completionTokens = chunk.usage.completion_tokens ?? 0;
          }
        } catch {
          // partial JSON — ignore
        }
      }
    }

    return new Response(
      JSON.stringify({
        id: requestId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: parsed.data.model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: fullContent || null },
          finish_reason: finishReason,
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      },
    );
  } catch {
    return apiError("RELAY_UNREACHABLE", 502, "无法连接 Relay 服务");
  }
}
