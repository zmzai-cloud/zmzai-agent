import { NextResponse, type NextRequest } from "next/server";

import { apiError, unauthenticated } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/session";
import { isMemoryConfigured, getMemoryProvider } from "@/lib/memory/provider";
import { getWorkspace } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdminUser(userId: string): boolean {
  const admins = (process.env.HINDSIGHT_ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return admins.includes(userId);
}

/** GET /api/workspaces/:workspaceId/memory — 自动记忆状态（spec §配置与 UI）。
 *  只返回聚合状态与条数，不暴露任何 hindsight 直链。 */
export async function GET(_: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");

  const enabled = isMemoryConfigured();
  const status = enabled ? await getMemoryProvider().status(workspaceId) : { available: false, factCount: null };
  return NextResponse.json(
    { memory: { enabled, available: status.available, facts: status.factCount, isAdmin: isAdminUser(user.id) } },
    { headers: { "cache-control": "no-store" } },
  );
}
