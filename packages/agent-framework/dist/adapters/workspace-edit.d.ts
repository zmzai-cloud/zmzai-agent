/** Pure workspace text-edit + diff helpers, shared by the framework's
 *  mongo-workspace (direct write/edit) and any code that renders a unified
 *  diff. Extracted from the legacy proposals module so the proposal-staging
 *  machinery could be retired without losing these. */
export type FileChange = {
    path: string;
    operation: "create" | "update" | "delete";
    before: string | null;
    after: string | null;
};
export declare function createUnifiedDiff(change: FileChange): string;
/** Applies an exact oldText → newText replacement. Returns an error when the
 *  target is missing or occurs more than once (ambiguous edit). */
export declare function applySingleEdit(content: string, oldText: string, newText: string): {
    content: string;
} | {
    error: string;
};
//# sourceMappingURL=workspace-edit.d.ts.map