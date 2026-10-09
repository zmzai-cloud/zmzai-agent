import { defaultStore } from "@/framework/core/runtime/runner";
import { WorkspaceModel } from "@/models/workspace";

/** No project membership fallback: memory banks belong exclusively to owners. */
export async function getOwnedWorkosSession(sessionId: string, userId: string) {
  const session = await defaultStore.getSession(sessionId);
  if (!session || session.userId !== userId) return null;
  const workspace = await WorkspaceModel.findOne({ workspaceId: session.workspaceId, userId }).lean();
  return workspace ? session : null;
}
