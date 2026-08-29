import type { ToolDef } from "./def.js";
/** apply_patch（P0 补齐）：把 unified diff 应用到 Workspace 文件。
 *  与 write/edit 同走 WorkspaceFiles 门面——每次落盘生成不可变版本与
 *  diff 记录（可审查、可回滚），不是裸文件写。
 *
 *  支持：一个补丁多文件 / 多 hunk / 新建文件（--- /dev/null）/ 行号漂移
 *  容差匹配。删除文件不被门面支持，明确报错。
 *  应用策略：两阶段——先对全部文件完成解析+试算（不写盘），任一失败整体
 *  拒绝并原样报错；全部通过后才逐个落盘。 */
export type FilePatch = {
    oldPath: string | null;
    newPath: string | null;
    hunks: Array<{
        oldStart: number;
        segments: Array<{
            kind: "context" | "remove" | "add";
            text: string;
        }>;
    }>;
};
export type PatchParseResult = {
    files: FilePatch[];
    errors: string[];
};
export declare function parseUnifiedPatch(patchText: string): PatchParseResult;
type ApplyOutcome = {
    ok: true;
    content: string;
    additions: number;
    deletions: number;
} | {
    ok: false;
    error: string;
};
export declare function applyFilePatch(original: string | null, patch: FilePatch): ApplyOutcome;
export type ApplyPatchReportEntry = {
    path: string;
    action: "created" | "updated";
    additions: number;
    deletions: number;
    revisionId: string;
};
export declare const applyPatchTool: ToolDef;
export {};
//# sourceMappingURL=patch.d.ts.map