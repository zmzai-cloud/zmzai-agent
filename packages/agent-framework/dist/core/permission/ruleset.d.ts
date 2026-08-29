/** Permission ruleset DSL (spec §5.1).
 *
 *  A ruleset is an ordered list of rules; the LAST matching rule wins and the
 *  default action when nothing matches is "ask". Config syntax mirrors
 *  opencode.json: a bare action string, or a map of permission -> action or
 *  pattern->action map. */
export type Action = "allow" | "deny" | "ask";
export type Rule = {
    permission: string;
    pattern: string;
    action: Action;
    expiresAt?: string;
};
export type Ruleset = Rule[];
export type PermissionConfig = Action | Record<string, Action | Record<string, Action>>;
/** Well-known permission keys (spec §5.1). Tools may introduce additional keys
 *  (e.g. future MCP `server_*`); the engine treats keys as opaque strings and
 *  matches them with wildcards. */
export declare const PERMISSIONS: readonly ["read", "edit", "bash", "glob", "grep", "list", "webfetch", "connector", "task", "todo", "external_directory", "mcp", "git_read", "git_write", "terminal"];
/** Converts config syntax into a flat ruleset. Key order in the config object
 *  is preserved, so later keys override earlier ones for overlapping matches. */
export declare function rulesetFromConfig(config: PermissionConfig): Ruleset;
/** Glob-style wildcard match: `*` matches any run of characters (including
 *  path separators), `?` matches one character. Same spirit as OpenCode's
 *  Wildcard.match — patterns are not filesystem paths, just strings. */
export declare function wildcardMatch(pattern: string, value: string): boolean;
/** Core evaluation: last matching rule across all rulesets (in order) wins.
 *  Later rulesets in the array have higher precedence. Default: "ask". */
export declare function evaluateRules(rulesets: Ruleset[], permission: string, pattern: string): Action;
//# sourceMappingURL=ruleset.d.ts.map