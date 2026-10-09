import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/database/mongodb";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { WorkspaceModel } from "@/models/workspace";
import { isMemoryConfigured } from "@/lib/memory/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cursorSchema = z.object({ createdAt: z.iso.datetime(), workspaceId: z.string().min(1).max(64) }).strict();

export async function GET(request: NextRequest) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  if (!isWorkosUserId(userId)) return NextResponse.json({ error: "INVALID_USER_ID" }, { status: 400 });
  const rawLimit = request.nextUrl.searchParams.get("limit") ?? "20";
  if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1) return NextResponse.json({ error: "INVALID_LIMIT" }, { status: 400 });
  const limit = Math.min(Number(rawLimit), 100);
  const rawCursor = request.nextUrl.searchParams.get("cursor");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (rawCursor !== null) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(rawCursor) || rawCursor.length > 512) throw new Error("cursor");
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")));
    } catch {
      return NextResponse.json({ error: "INVALID_CURSOR" }, { status: 400 });
    }
  }
  await connectMongo();
  const createdAt = cursor ? new Date(cursor.createdAt) : null;
  const workspaces = await WorkspaceModel.find({ userId, ...(cursor ? { $or: [{ createdAt: { $gt: createdAt } }, { createdAt, workspaceId: { $gt: cursor.workspaceId } }] } : {}) })
    .sort({ createdAt: 1, workspaceId: 1 }).limit(limit + 1).select({ workspaceId: 1, name: 1, createdAt: 1 }).lean();
  const page = workspaces.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = workspaces.length > limit && last
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), workspaceId: last.workspaceId })).toString("base64url") : null;
  const memoryEnabled = isMemoryConfigured();
  return NextResponse.json({ items: page.map(({ workspaceId, name }) => ({ workspaceId, name, memoryEnabled })), nextCursor }, { headers: { "cache-control": "no-store" } });
}
