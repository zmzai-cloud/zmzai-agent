import { NextResponse } from "next/server";

import { apiError, unauthenticated } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/session";
import { WebhookDeliveryModel } from "@/models/webhook-delivery";
import { WebhookSubscriptionModel } from "@/models/webhook-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ subscriptionId: string; deliveryId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { subscriptionId, deliveryId } = await context.params;
  if (!(await WebhookSubscriptionModel.exists({ subscriptionId, userId: user.id }))) return apiError("WEBHOOK_NOT_FOUND", 404, "Webhook 不存在或无权访问");
  const delivery = await WebhookDeliveryModel.findOne({ deliveryId, subscriptionId }).lean();
  if (!delivery) return apiError("DELIVERY_NOT_FOUND", 404, "投递记录不存在");
  if (delivery.status !== "failed") return apiError("DELIVERY_NOT_RETRYABLE", 422, "只能重试已失败的投递");
  await WebhookDeliveryModel.updateOne({ deliveryId }, { $set: { status: "pending", nextAttemptAt: new Date(), attempts: 0, lastError: null, leaseExpiresAt: null } });
  return NextResponse.json({ deliveryId, status: "pending" }, { headers: { "cache-control": "no-store" } });
}
