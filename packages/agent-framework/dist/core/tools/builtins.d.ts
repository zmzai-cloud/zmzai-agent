import type { ToolDef } from "../tools/def.js";
/** Built-in tools (spec §7.2). These operate on the WorkspaceFiles facade, so
 *  the same definitions serve the Mongo cloud backend and a future local FS
 *  backend. */
export declare const readTool: ToolDef;
export declare const globTool: ToolDef;
export declare const grepTool: ToolDef;
export declare const writeTool: ToolDef;
export declare const editTool: ToolDef;
export declare const todoTool: ToolDef;
export declare const bashTool: ToolDef;
export declare const builtinTools: ToolDef[];
//# sourceMappingURL=builtins.d.ts.map