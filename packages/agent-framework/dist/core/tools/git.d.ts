import type { ToolDef } from "./def.js";
/** Git 工具集（P0）：把裸敲 `bash git …` 升级为结构化专用工具。
 *  与 opencode git.ts / codex git-utils 对齐的四个最小面：
 *  status / diff / log 只读（git_read，默认放行），commit 写级
 *  （git_write，走审批）。在真实仓库上执行——不是沙箱快照里的临时副本，
 *  否则 commit 会随快照销毁而丢失。宿主用 cwd 绑定各自的仓库根。 */
export type GitToolsOptions = {
    /** 返回执行 git 命令的仓库根目录。函数形式便于多会话绑定各自工作区。 */
    cwd: () => string;
};
export declare function createGitTools(options: GitToolsOptions): ToolDef[];
//# sourceMappingURL=git.d.ts.map