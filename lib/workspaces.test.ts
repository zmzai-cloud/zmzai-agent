import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceModel = vi.hoisted(() => ({
  create: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  find: vi.fn(),
  exists: vi.fn(),
  deleteOne: vi.fn(),
}));

vi.mock("@/models/workspace", () => ({ WorkspaceModel: workspaceModel }));

import { createWorkspace, ensureDefaultWorkspace, getWorkspace, listWorkspaces, updateWorkspace } from "@/lib/workspaces";

const createdAt = new Date("2026-08-20T00:00:00.000Z");
const updatedAt = new Date("2026-08-20T01:00:00.000Z");

const rawWorkspace = {
  workspaceId: "ws_test",
  userId: "user_1",
  name: "测试智能体",
  description: "描述",
  currentRevisionId: null,
  defaultModel: "deepseek-v4-flash",
  approvalMode: "ask" as const,
  prompt: "You are helpful.",
  steps: 12,
  tools: [],
  skillIds: ["skl_1"],
  pluginIds: [],
  connectorIds: ["conn_1"],
  knowledgeBase: [{ entryId: "kb_1", title: "API Spec", content: "Use Bearer auth." }],
  permission: [{ permission: "bash", pattern: "rm *", action: "deny" as const }],
  createdAt,
  updatedAt,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toWorkspaceSummary (via getWorkspace)", () => {
  it("maps all fields including knowledgeBase", async () => {
    workspaceModel.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(rawWorkspace) });
    const result = await getWorkspace("user_1", "ws_test");
    expect(result).toEqual({
      id: "ws_test",
      name: "测试智能体",
      description: "描述",
      currentRevisionId: null,
      defaultModel: "deepseek-v4-flash",
      approvalMode: "ask",
      prompt: "You are helpful.",
      steps: 12,
      tools: [],
      skillIds: ["skl_1"],
      pluginIds: [],
      connectorIds: ["conn_1"],
      knowledgeBase: [{ entryId: "kb_1", title: "API Spec", content: "Use Bearer auth." }],
      permission: [{ permission: "bash", pattern: "rm *", action: "deny" }],
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
  });

  it("defaults missing optional fields", async () => {
    const minimal = { ...rawWorkspace, prompt: undefined, steps: undefined, tools: undefined, skillIds: undefined, pluginIds: undefined, connectorIds: undefined, knowledgeBase: undefined, permission: undefined };
    workspaceModel.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(minimal) });
    const result = await getWorkspace("user_1", "ws_test");
    expect(result).toMatchObject({ prompt: "", steps: 12, tools: [], skillIds: [], pluginIds: [], connectorIds: [], knowledgeBase: [], permission: [] });
  });

  it("returns null when workspace does not exist", async () => {
    workspaceModel.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    expect(await getWorkspace("user_1", "ws_missing")).toBeNull();
  });
});

describe("createWorkspace", () => {
  it("creates with approvalMode=ask and returns summary", async () => {
    workspaceModel.create.mockResolvedValue(rawWorkspace);
    const result = await createWorkspace({ workspaceId: "ws_test", userId: "user_1", name: "测试智能体", description: "描述", defaultModel: "deepseek-v4-flash", prompt: "You are helpful." });
    expect(workspaceModel.create).toHaveBeenCalledWith(expect.objectContaining({ approvalMode: "ask", prompt: "You are helpful." }));
    expect(result.id).toBe("ws_test");
  });

  it("omits prompt when not provided", async () => {
    workspaceModel.create.mockResolvedValue(rawWorkspace);
    await createWorkspace({ workspaceId: "ws_test", userId: "user_1", name: "测试", description: "", defaultModel: "m" });
    const call = workspaceModel.create.mock.calls[0]![0];
    expect(call).not.toHaveProperty("prompt");
  });
});

describe("ensureDefaultWorkspace", () => {
  it("is a no-op when a default workspace already exists", async () => {
    workspaceModel.exists.mockReturnValue({ lean: vi.fn().mockResolvedValue(true) });
    await ensureDefaultWorkspace("user_1");
    expect(workspaceModel.create).not.toHaveBeenCalled();
  });

  it("creates a default workspace when none exists", async () => {
    workspaceModel.exists.mockReturnValue({ lean: vi.fn().mockResolvedValue(false) });
    workspaceModel.create.mockResolvedValue({});
    await ensureDefaultWorkspace("user_1");
    expect(workspaceModel.create).toHaveBeenCalledWith(expect.objectContaining({ name: "通用", approvalMode: "ask" }));
  });
});

describe("updateWorkspace", () => {
  it("applies only the provided fields", async () => {
    workspaceModel.findOneAndUpdate.mockReturnValue({ lean: vi.fn().mockResolvedValue(rawWorkspace) });
    await updateWorkspace("user_1", "ws_test", { name: "新名称", approvalMode: "auto" });
    const setClause = workspaceModel.findOneAndUpdate.mock.calls[0]![1].$set;
    expect(setClause).toEqual({ name: "新名称", approvalMode: "auto" });
    expect(setClause).not.toHaveProperty("description");
    expect(setClause).not.toHaveProperty("prompt");
  });

  it("returns current workspace when no fields are provided", async () => {
    workspaceModel.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(rawWorkspace) });
    const result = await updateWorkspace("user_1", "ws_test", {});
    expect(result?.id).toBe("ws_test");
    expect(workspaceModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("listWorkspaces", () => {
  it("ensures default workspace and returns sorted results", async () => {
    workspaceModel.exists.mockReturnValue({ lean: vi.fn().mockResolvedValue(true) });
    workspaceModel.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([rawWorkspace]) }) });
    const result = await listWorkspaces("user_1");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("ws_test");
  });
});
