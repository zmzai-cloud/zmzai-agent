import type { ToolDef } from "../tools/def.js";
/** task tool (spec §6.4): spawns a subagent as a child session. Depth is
 *  capped, the child inherits the parent workspace + a permission ruleset
 *  merging parent session rules and the subagent preset, and the child runs
 *  to completion within this tool call. The rendered <task> result goes back
 *  to the parent model; a subtask part is recorded in the parent transcript. */
export declare const taskTool: ToolDef;
//# sourceMappingURL=task.d.ts.map