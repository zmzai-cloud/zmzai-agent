/** 子代理写路径隔离（tutorial-advanced 07-subagent retrofit / WritePathSet）：
 *
 *  子代理默认继承父代理的全部写权限——信任边界与父级相同。声明式白名单
 *  （AgentInfo.writePaths）让 preset 自己声明"这个代理只允许写哪里"，
 *  未声明则行为完全不变（opt-in，不破坏既有 preset 与 e2e）。
 *
 *  双层防御：
 *  1. 权限层（writePathGuardRules）：利用 LAST matching rule wins——白名单
 *     allow 规则在前、全局 edit deny 兜底排在规则集末尾，越界写被规则拒绝。
 *  2. 结构层（confineWorkspaceFiles）：包住 workspace 门面，越界 write/edit
 *     直接抛错——权限层管的是"审批"，结构层管的是"不可达"：即使未来新增
 *     工具绕过权限引擎直接调 workspace，也无法越界写。
 *
 *  读/list 不受限：探索型子代理需要全库视野，只圈写。路径是 workspace 相对
 *  字符串（与 WorkspaceFiles 契约一致），匹配复用规则集同款通配符，保证
 *  权限层与结构层对"越界"的判定逐字节一致。 */
import type { WorkspaceFiles } from "../tools/context.js";
import { type Rule } from "./ruleset.js";
/** 路径是否落在写路径白名单内：等于白名单根，或位于其子树。 */
export declare function pathInWritePaths(p: string, writePaths: string[]): boolean;
/** 写路径守卫规则：白名单 allow 在前，全局 edit deny 兜底在后。
 *  LAST matching rule wins——兜底必须排在规则集最后才生效。 */
export declare function writePathGuardRules(writePaths: string[]): Rule[];
/** 结构层圈禁：包住 workspace 门面，越界 write/edit 直接抛错（不可绕过）。
 *  read/list 保持原样——探索型子代理需要全库视野，只圈写。 */
export declare function confineWorkspaceFiles(workspace: WorkspaceFiles, writePaths: string[]): WorkspaceFiles;
//# sourceMappingURL=write-path.d.ts.map