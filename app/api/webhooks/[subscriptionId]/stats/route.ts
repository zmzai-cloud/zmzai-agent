import { NextResponse } from "next/server";

import { apiError, unauthenticated } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/session";
import { WebhookDeliveryModel } from "@/models/webhook-delivery";
import { WebhookSubscriptionModel } from "@/models/webhook-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ subscriptionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { subscriptionId } = await context.params;
  if (!(await WebhookSubscriptionModel.exists({ subscriptionId, userId: user.id }))) return apiError("WEBHOOK_NOT_FOUND", 404, "Webhook 不存在或无权访问");
  const [delivered, pending, failed, total] = await Promise.all([
    WebhookDeliveryModel.countDocuments({ subscriptionId, status: "delivered" }),
    WebhookDeliveryModel.countDocuments({ subscriptionId, status: { $in: ["pending", "delivering"] } }),
    WebhookDeliveryModel.countDocuments({ subscriptionId, status: "failed" }),
    WebhookDeliveryModel.countDocuments({ subscriptionId }),
  ]);
  // Count consecutive recent failures for health indicator
  const recentDeliveries = await WebhookDeliveryModel.find({ subscriptionId }).sort({ createdAt: -1 }).limit(20).select({ status: 1 }).lean();
  let consecutiveFailures = 0;
  for (const d of recentDeliveries) {
    if (d.status === "failed") consecutiveFailures += 1;
    else break;
  }
  return NextResponse.json({ delivered, pending, failed, total, consecutiveFailures }, { headers: { "cache-control": "no-store" } });
}
