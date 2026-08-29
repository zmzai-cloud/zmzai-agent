import type { WorkspaceFiles } from "../tools/context.js";
import type { AgentInfo } from "../agent/registry.js";
/** Custom agent loader (spec §6.3): workspace agents live at `.zmzai/agents/*.md`
 *  with YAML-ish frontmatter and the body as the system prompt. Frontmatter is
 *  parsed with a small zero-dependency reader (no js-yaml in the dep tree) —
 *  it supports the flat keys we need plus a nested `permission:` map. */
export type LoadedAgent = {
    fileName: string;
    agent: AgentInfo;
};
/** Loads `.zmzai/agents/*.md` from the workspace. Unreadable files are skipped
 *  silently; malformed files raise a descriptive error (surfaced to the user). */
export declare function loadCustomAgents(workspace: WorkspaceFiles): Promise<{
    agents: AgentInfo[];
    errors: string[];
}>;
//# sourceMappingURL=loader.d.ts.map