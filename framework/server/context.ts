import { AgentRegistry, createAgentRuntime, type SessionInfo, type ModelRef, type ToolContext, type PermissionEngine, type Ruleset, type SessionRunner } from "@zmzai/agent-framework";
import { loadCustomAgents, createFsWorkspaceFiles, createSubprocessSandbox, createMemoryEventLog } from "@zmzai/agent-framework";
import { productEventLog } from "@/framework/core/events/product-event-log";
import { createMongoWorkspaceFiles, createWorkspaceAggregateFiles } from "@/framework/core/tools/mongo-workspace";
import { defaultStore } from "@/framework/core/runtime/runner";
import { createRelayModel, createRelayStreamFunction } from "@/lib/relay-agent-stream";
import { resolveLocalTools } from "@/lib/relay-local-tools";
import { buildExecSnapshot } from "@/lib/sandbox-snapshot";
import { runSandboxCommandAndStream } from "@/lib/sandbox-execution";
import { activeRunIdForSession } from "@/lib/task-run-control";
import { FrameworkSessionModel } from "@/framework/core/session/mongo-models";
import { defaultRelayModel, getWorkspace } from "@/lib/workspaces";
import { resolveWorkspaceConnectorTools } from "@/lib/mcp-connector-tools";
import { combineAgentInstructions } from "@/lib/project-agent-context";
import { getWorkspaceSkillsByIds } from "@/lib/workspace-skills";
import { getWorkspacePluginSkillsByIds } from "@/lib/workspace-plugins";
import { taskForSession } from "@/lib/task-run-control";
import { recallMemoryContext } from "@/lib/memory/recall-context";
import { createMemoryRetainHook } from "@/lib/memory/retain-hook";
import { ProjectModel } from "@/models/project";
import { ProjectContextItemModel } from "@/models/project-context-item";

/** Process-wide runner singleton assembled from the framework package + the
 *  product's Mongo/relay/OpenSandbox adapters (M5 §3). */

const globalHolder = globalThis as typeof globalThis & { __zmzaiFrameworkRunner?: SessionRunner | null };

/** FW_MODE=local：全本地演示链路（零 Mongo/relay 依赖）。API 侧 defaultStore
 *  已切 JSONL，这里把 workspace/sandbox/eventLog/agents 一并切到本地实现，
 *  否则 session 在 JSONL 而 runner 在 Mongo，链路跑不通。 */
const localMode = process.env.FW_MODE?.trim() === "local";
const localWorkspaceRoot = process.env.FW_WORKSPACE_DIR?.trim() || "./.fw-workspace";
const localWorkspaceFiles = () => createFsWorkspaceFiles({ root: localWorkspaceRoot });

function getOrCreateRunner(): SessionRunner {
  if (globalHolder.__zmzaiFrameworkRunner) return globalHolder.__zmzaiFrameworkRunner;

  // 装配收敛（spec D2，Batch 4）：改走 createAgentRuntime(preset)。后端差异
  // 以 workspace/sandbox 声明，repo_map 能力由工厂接线（localMode 开/云端关），
  // 产品级字段（agentResolver/memory/lease）经 runnerOptions 透传。
  const runtime = createAgentRuntime({
    store: defaultStore,
    eventLog: localMode ? createMemoryEventLog() : productEventLog,
    // relay 双函数装配（旧式）：经 runnerOptions 透传，覆盖 modelProvider 派生
    workspace: localMode
      ? { kind: "fs", root: localWorkspaceRoot }
      : { kind: "custom", workspaceFor: (session: SessionInfo) => createMongoWorkspaceFiles({ userId: session.userId, workspaceId: session.workspaceId, sessionId: session.id }) },
    sandbox: localMode ? { kind: "subprocess" } : {
      buildSnapshot: async (input) => (await buildExecSnapshot({ userId: input.userId, workspaceId: input.workspaceId, runId: input.runId })).snapshot,
      run: async (input) => {
        const result = await runSandboxCommandAndStream({
          userId: input.userId,
          runId: await activeRunIdForSession(input.runId),
          workspaceId: input.workspaceId,
          toolCallId: input.toolCallId,
          snapshot: input.snapshot,
          command: input.command,
        });
        return {
          ok: result.ok,
          outcome: result.outcome,
          exitCode: result.exitCode,
          outputText: result.outputText,
          durationMs: result.durationMs,
          ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
          artifacts: result.artifacts.map((artifact) => {
            const previewable = /^(text\/html|image\/(png|jpeg|gif|svg\+xml|webp)|application\/pdf|text\/(plain|markdown|css)|application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation)/.test(artifact.contentType.toLowerCase());
            const base = artifact.artifactId ? `/api/fw/sessions/${input.runId}/artifacts/${artifact.artifactId}` : null;
            return {
              ...(artifact.artifactId ? { artifactId: artifact.artifactId } : {}),
              path: artifact.path,
              bytes: artifact.bytes,
              contentType: artifact.contentType,
              downloadUrl: base ? `${base}/download` : "",
              ...(base && previewable ? { previewUrl: `${base}/preview` } : {}),
              ...(artifact.workspaceContent !== undefined ? { workspaceContent: artifact.workspaceContent } : {}),
            };
          }),
        };
      },
    },
    // Repo Map（R1）：云端模式 workspace 在 Mongo 虚拟 fs + sandbox 容器内，
    // framework 的本地 fs 索引够不到，显式关闭；localMode 随 fs 工作区接线。
    capabilities: localMode ? { repoMap: { workspaceRoot: localWorkspaceRoot }, subagents: 1 } : { repoMap: false, subagents: 1 },
    runnerOptions: {
      streamFnFor: (session) => createRelayStreamFunction({ userId: session.userId, taskRunId: () => activeRunIdForSession(session.id) }),
      modelFor: (ref: ModelRef) => createRelayModel(ref.modelId),
      leaseStore: localMode
      ? undefined
      : {
      stamp: async (sessionId, owner, expiresAt) => {
        await FrameworkSessionModel.updateOne({ sessionId }, { $set: { leaseOwner: owner, leaseExpiresAt: expiresAt } }).catch(() => undefined);
      },
      clear: async (sessionId) => {
        await FrameworkSessionModel.updateOne({ sessionId }, { $set: { leaseOwner: null, leaseExpiresAt: null } }).catch(() => undefined);
      },
    },
      sessionRuleTtlMs: 24 * 60 * 60_000,
      // 本机工具（用户桌面 fs/shell/notify）：本地演示模式（无 relay）不启用；
      // 注意条件展开而非传 undefined——否则会覆盖工厂注入的能力工具（repo_map）
      ...(localMode ? {} : { localTools: resolveLocalTools() }),
      loadWorkspaceAgents: localMode
        ? async () => (await loadCustomAgents(localWorkspaceFiles())).agents
        : async (session: SessionInfo) => {
      // .zmzai/agents/*.md 是 workspace 级资产（跨会话共享），走聚合视图而非会话隔离视图
      const workspace = createWorkspaceAggregateFiles(session.workspaceId);
      const { agents } = await loadCustomAgents(workspace);
      return agents;
    },
      agentResolver: localMode
      ? undefined
      : {
      // Workspace = 智能体：从 workspace 文档读 prompt/steps/permission，
      // 返回 ResolvedAgent。不再走 AgentVersion（已废弃）。
      resolve: async (session) => {
        // Child sessions must keep their explicit `explore` / `general`
        // identity. Applying the Workspace primary-agent resolver here would
        // silently replace its prompt, steps and permission policy.
        if (session.parentId) return null;
        const ws = await getWorkspace(session.userId, session.workspaceId);
        if (!ws) return null;
        const task = await taskForSession(session.id);
        const project = task?.projectId ? await ProjectModel.findOne({ projectId: task.projectId, userId: session.userId, workspaceId: session.workspaceId }).select({ projectId: 1, instructions: 1 }).lean() : null;
        const projectContext = project ? await ProjectContextItemModel.find({ projectId: project.projectId, userId: session.userId, workspaceId: session.workspaceId, enabled: true }).select({ type: 1, title: 1, content: 1, url: 1 }).sort({ createdAt: 1 }).lean() : [];
        const [skills, pluginSkills] = await Promise.all([
          getWorkspaceSkillsByIds({ userId: session.userId, workspaceId: session.workspaceId, skillIds: ws.skillIds }),
          getWorkspacePluginSkillsByIds({ userId: session.userId, workspaceId: session.workspaceId, pluginIds: ws.pluginIds }),
        ]);
        const knowledgeBase = (ws.knowledgeBase ?? []) as Array<{ entryId: string; title: string; content: string }>;
        // 自治档位：auto 档在 workspace 规则前预置 bash 放行；排在后面（last-match-wins）
        // 的显式规则仍可覆盖它，deny/ask 不被绕过。"always" 是历史值，等同 ask。
        const autoAllow: Ruleset = ws.approvalMode === "auto" ? [{ permission: "bash", pattern: "*", action: "allow" }] : [];
        return {
          agent: {
            name: ws.name || "default",
            description: ws.description || undefined,
            mode: "primary",
            model: { providerId: "relay", modelId: ws.defaultModel },
            prompt: combineAgentInstructions(ws.prompt, project?.instructions, projectContext, knowledgeBase, [...skills, ...pluginSkills]),
            steps: ws.steps,
            permission: [...autoAllow, ...(ws.permission as Ruleset)],
          },
          tools: await resolveWorkspaceConnectorTools({ userId: session.userId, workspaceId: session.workspaceId, connectorIds: ws.connectorIds }),
        };
      },
    },
    compaction: { enabled: true, contextWindow: 128_000, summaryModel: createRelayModel(defaultRelayModel) },
    // 长期记忆（spec §记忆）：recall 注入 + 终态 retain。未配 HINDSIGHT_API_URL
    // 时 provider 是 noop，两个挂点零开销、行为零变化。
    memoryContextFor: (session, text) => recallMemoryContext(session, text),
    hooks: [createMemoryRetainHook()],
    },
  });

  const runner = runtime.runner;
  globalHolder.__zmzaiFrameworkRunner = runner;
  return runner;
}

export function getFrameworkRunner(): SessionRunner {
  return getOrCreateRunner();
}

export function getFrameworkRegistry(): AgentRegistry {
  return new AgentRegistry();
}

export type { SessionInfo, ModelRef, ToolContext, PermissionEngine };
