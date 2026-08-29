import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { createRequire } from "node:module";
let cachedBackend = null;
/** 同步探测：node-pty 是 CJS 包，用 createRequire 从本模块位置解析——
 *  异步 import().then(...) 会造成首启动时 backend.kind 尚未确定的竞态。 */
function tryLoadNodePty() {
    try {
        // 变量名解析：框架不硬依赖 node-pty（可选原生依赖），缺失/ABI 不匹配时静默降级
        const specifier = ["node", "pty"].join("-");
        const mod = requireFromModuleContext(specifier);
        return mod.default ?? mod;
    }
    catch {
        return null;
    }
}
const requireFromModuleContext = typeof import.meta?.url === "string" && import.meta.url !== "file://"
    ? createRequire(
    // 运行在编译后的 ESM/CJS 均可：从自身位置出发向上找最近 node_modules
    (() => {
        try {
            return new URL("../adapters/", import.meta.url).href;
        }
        catch {
            return process.cwd();
        }
    })())
    : createRequire(process.cwd());
/** 宿主终端后端单例：优先真 PTY，node-pty 不可用或 spawn 探测失败时降级管道模式。
 *  首次调用即锁定后端种类（同步），session 标签从此不存在竞态。 */
export function createHostTerminalBackend() {
    if (!cachedBackend) {
        const mod = tryLoadNodePty();
        // 加载成功 ≠ 能用：新 Node 运行时与旧 node-pty 的 posix_spawnp 不兼容这类问题
        // 只有真正 spawn 时才暴露，探测一次，失败永久降级 pipe（功能等价）。
        cachedBackend = mod && probePtySpawn(mod) ? createNodePtyBackend(mod) : createPipeBackend();
    }
    return cachedBackend;
}
/** 同步 spawn 探测：能 fork /bin/sh -c true 即认为 pty 可用。 */
function probePtySpawn(mod) {
    try {
        const term = mod.spawn("/bin/sh", ["-c", "true"], {
            name: "xterm-256color",
            cols: 20,
            rows: 5,
            cwd: process.cwd(),
        });
        term.kill();
        return true;
    }
    catch {
        return false;
    }
}
/** 统一 POSIX sh 执行（不用 $SHELL）：agent 语义需要可预测的语法方言，
 *  fish/zsh 差异会造成同一条命令两种结果。 */
function shell() {
    if (process.platform === "win32")
        return { file: "cmd.exe", prefixArgs: ["/d", "/s", "/c"] };
    return { file: "/bin/sh", prefixArgs: ["-c"] };
}
/** 管道模式：detached 进程组 + 负值 pid 组杀，保证 npm run dev 这类带子进程的树能整树回收。 */
function createPipeBackend() {
    return {
        kind: "pipe",
        async start(input, hooks) {
            const { file, prefixArgs } = shell();
            const child = spawn(file, [...prefixArgs, input.command], {
                cwd: input.cwd,
                env: input.env ? { ...process.env, ...input.env } : undefined,
                stdio: ["pipe", "pipe", "pipe"],
                detached: process.platform !== "win32",
            });
            let exited = false;
            const forward = (buf) => {
                if (!exited)
                    hooks.onData(buf.toString("utf8"));
            };
            child.stdout.on("data", forward);
            child.stderr.on("data", forward);
            child.on("error", (error) => {
                if (!exited)
                    hooks.onData(`\n[pipe] 进程启动失败：${error.message}\n`);
            });
            child.on("close", (code, signal) => {
                exited = true;
                hooks.onData(child.exitCode == null && signal ? `\n[终端被 ${signal} 终止]\n` : "");
                hooks.onExit({ exitCode: code ?? child.exitCode ?? null, signal: signal ?? null });
            });
            const pid = child.pid;
            return {
                pid,
                write(data) {
                    if (!child.stdin?.destroyed)
                        child.stdin.write(data);
                },
                kill(signal = "SIGTERM") {
                    if (exited)
                        return;
                    try {
                        if (pid != null && process.platform !== "win32")
                            process.kill(-pid, signal);
                        else
                            child.kill(signal);
                    }
                    catch {
                        child.kill("SIGKILL");
                    }
                },
            };
        },
    };
}
function createNodePtyBackend(moduleRef) {
    return {
        kind: "pty",
        async start(input, hooks) {
            const cwdAbs = isAbsolute(input.cwd) ? input.cwd : resolve(input.cwd);
            const { file, prefixArgs } = shell();
            // 整条命令交给用户的 shell 执行（sh -c "<command>"）
            const term = moduleRef.spawn(file, [...prefixArgs, input.command], {
                name: "xterm-256color",
                cols: input.cols ?? 120,
                rows: input.rows ?? 30,
                cwd: cwdAbs,
                env: { ...process.env, ...(input.env ?? {}) },
            });
            wirePty(term, hooks);
            return {
                pid: term.pid,
                write: (data) => term.write(data),
                kill: (signal) => term.kill(signal),
                resize: (cols, rows) => term.resize(cols, rows),
            };
        },
    };
}
function wirePty(term, hooks) {
    let exitSeen = false;
    term.onData((chunk) => {
        if (!exitSeen)
            hooks.onData(chunk);
    });
    term.onExit(({ exitCode, signal }) => {
        exitSeen = true;
        // node-pty 正常退出时可能给 signal=0（数字），不是真的收到信号
        const normalizedSignal = signal == null || Number(signal) === 0 || String(signal).trim() === "" ? null : String(signal);
        hooks.onExit({ exitCode, signal: normalizedSignal });
    });
}
//# sourceMappingURL=terminal-backend.js.map