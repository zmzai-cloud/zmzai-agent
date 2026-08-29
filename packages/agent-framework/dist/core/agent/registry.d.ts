import { type PermissionConfig, type Ruleset } from "../permission/ruleset.js";
import type { ModelRef } from "../session/types.js";
/** Agent registry (spec §6). Agents are named bundles of (prompt, permission
 *  ruleset, model override, step budget). Primary agents answer user prompts;
 *  subagents are spawned by the task tool. There is no mode toggle — the
 *  presets below replace plan/build (spec §6.2). */
export type AgentInfo = {
    name: string;
    description?: string;
    mode: "primary" | "subagent" | "all";
    hidden?: boolean;
    model?: ModelRef;
    temperature?: number;
    topP?: number;
    prompt?: string;
    steps?: number;
    permission: Ruleset;
    /** 写路径白名单（WritePathSet，07-subagent retrofit）：声明后该代理的
     *  write/edit 被圈禁在白名单内；未声明则不限制（opt-in）。 */
    writePaths?: string[];
};
export type AgentDefinition = Omit<AgentInfo, "permission"> & {
    permission: PermissionConfig;
};
export declare const builtinAgents: AgentInfo[];
/** Built-in baseline applied beneath every agent's own ruleset (spec §5.5). */
export declare const builtinDefaults: Ruleset;
export declare class AgentRegistry {
    private readonly agents;
    constructor(customAgents?: AgentInfo[]);
    get(name: string): AgentInfo | null;
    list(filter?: {
        mode?: "primary" | "subagent";
        includeHidden?: boolean;
    }): AgentInfo[];
    /** Effective ruleset stack for a session running this agent, in ascending
     *  precedence: builtin defaults → agent preset. Session rules are appended
     *  later by the permission engine. */
    rulesetsFor(name: string): Ruleset[];
    /** Returns a NEW registry with additional agents layered on top (workspace
     *  custom agents). The base registry is shared/process-wide, so per-run
     *  customization must not mutate it — this derive keeps the singleton
     *  immutable while letting a session see its workspace's .zmzai/agents. */
    derive(extraAgents: AgentInfo[]): AgentRegistry;
    /** Custom agents registered beyond the builtins (for derive()). */
    get customAgents(): AgentInfo[];
}
//# sourceMappingURL=registry.d.ts.map