import { createHash, randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnvironment } from "@/config/env";
import { apiError, unauthenticated } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/session";
import { TaskModel } from "@/models/task";
import { TaskShareModel } from "@/models/task-share";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const shareSchema = z.object({ expiresInDays: z.number().int().min(1).max(90).optional() }).strict();
const DEFAULT_SHARE_TTL_DAYS = 14;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** POST — 创建任务分享链接（任务 owner 才能分享） */
export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { taskId } = await context.params;
  const parsed = shareSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "分享请求格式不正确");
  const task = await TaskModel.findOne({ taskId, userId: user.id }).select({ taskId: 1, userId: 1 }).lean();
  if (!task) return apiError("TASK_NOT_FOUND", 404, "任务不存在或无权分享");

  const token = randomBytes(32).toString("base64url");
  const ttlDays = parsed.data.expiresInDays ?? DEFAULT_SHARE_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60_000);

  // 删除旧分享（每个任务同时只有一个有效分享链接）
  await TaskShareModel.deleteMany({ taskId });
  await TaskShareModel.create({
    shareId: `share_${randomUUID()}`,
    taskId,
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt,
  });

  const base = getServerEnvironment().APP_URL.replace(/\/$/, "");
  return NextResponse.json({ shareUrl: `${base}/share/t/${token}`, expiresAt: expiresAt.toISOString() }, { headers: { "cache-control": "no-store" } });
}

/** DELETE — 撤销任务分享 */
export async function DELETE(_: Request, context: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { taskId } = await context.params;
  const task = await TaskModel.findOne({ taskId, userId: user.id }).select({ taskId: 1 }).lean();
  if (!task) return apiError("TASK_NOT_FOUND", 404, "任务不存在或无权操作");
  await TaskShareModel.deleteMany({ taskId });
  return NextResponse.json({ revoked: true }, { headers: { "cache-control": "no-store" } });
}

/** GET — 查询当前分享状态 */
export async function GET(_: Request, context: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { taskId } = await context.params;
  const task = await TaskModel.findOne({ taskId, userId: user.id }).select({ taskId: 1 }).lean();
  if (!task) return apiError("TASK_NOT_FOUND", 404, "任务不存在或无权查看");
  const share = await TaskShareModel.findOne({ taskId }).select({ expiresAt: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean();
  if (!share) return NextResponse.json({ shared: false }, { headers: { "cache-control": "no-store" } });
  const base = getServerEnvironment().APP_URL.replace(/\/$/, "");
  return NextResponse.json({ shared: true, expiresAt: share.expiresAt.toISOString(), shareUrl: `${base}/share/t/...` }, { headers: { "cache-control": "no-store" } });
}
