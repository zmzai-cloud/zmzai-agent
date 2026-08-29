import { SessionRunner, createFrameworkSession } from "../core/runtime/runner.js";
import { AgentRegistry } from "../core/agent/registry.js";
import { noopSandboxExecutor } from "../adapters/index.js";
export function createServer(deps) {
    const registry = deps.registry ?? new AgentRegistry();
    const runner = new SessionRunner({
        store: deps.store,
        registry,
        streamFnFor: (session) => deps.modelProvider.streamFor(session),
        modelFor: (ref) => deps.modelProvider.getModel(ref),
        eventLog: deps.eventLog,
        workspaceFor: deps.workspaceFor,
        sandbox: deps.sandbox ?? noopSandboxExecutor(),
        ...(deps.loadWorkspaceAgents ? { loadWorkspaceAgents: deps.loadWorkspaceAgents } : {}),
        ...(deps.localTools ? { localTools: deps.localTools } : {}),
        ...(deps.hooks ? { hooks: deps.hooks } : {}),
        subagentDepth: deps.subagentDepth ?? 1,
        ...(deps.compaction ? { compaction: deps.compaction } : {}),
        ...(deps.leaseStore ? { leaseStore: deps.leaseStore } : {}),
    });
    return {
        runner,
        store: deps.store,
        eventLog: deps.eventLog,
        registry,
        async createSession(input) {
            return createFrameworkSession({ store: deps.store, ...input });
        },
    };
}
//# sourceMappingURL=create-server.js.map