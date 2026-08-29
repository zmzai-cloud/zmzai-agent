import { z } from "zod";
const DRIFT_WINDOW = 300;
const NULL_PATH = /^(\/dev\/null|NUL)$/i;
function stripHeaderPath(raw) {
    const noTimestamp = raw.split("\t")[0].trim();
    if (NULL_PATH.test(noTimestamp))
        return null;
    return noTimestamp.replace(/^[ab]\//, "");
}
export function parseUnifiedPatch(patchText) {
    const files = [];
    const errors = [];
    const lines = patchText.replace(/\r\n/g, "\n").split("\n");
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (!line.startsWith("--- ")) {
            index += 1;
            continue;
        }
        const plusLine = lines[index + 1];
        if (!plusLine?.startsWith("+++ ")) {
            errors.push(`第 ${index + 1} 行 --- 之后缺少 +++ 文件头`);
            break;
        }
        const filePatch = {
            oldPath: stripHeaderPath(line.slice(4)),
            newPath: stripHeaderPath(plusLine.slice(4)),
            hunks: [],
        };
        index += 2;
        while (index < lines.length && lines[index].startsWith("@@")) {
            const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index]);
            if (!head) {
                errors.push(`无法解析 hunk 头：${lines[index].slice(0, 60)}`);
                index = lines.length;
                break;
            }
            const oldStart = Number(head[1]);
            index += 1;
            const segments = [];
            let consumedOldSide = 0;
            while (index < lines.length) {
                const body = lines[index];
                if (body.startsWith("@@") || body.startsWith("--- "))
                    break;
                if (body.startsWith("\\ No newline at end of file")) {
                    index += 1;
                    continue;
                }
                if (body.startsWith(" ") || body === "") {
                    segments.push({ kind: "context", text: body.slice(1) });
                    consumedOldSide += 1;
                    index += 1;
                }
                else if (body.startsWith("-")) {
                    segments.push({ kind: "remove", text: body.slice(1) });
                    consumedOldSide += 1;
                    index += 1;
                }
                else if (body.startsWith("+")) {
                    segments.push({ kind: "add", text: body.slice(1) });
                    index += 1;
                }
                else {
                    break; // 非补丁正文（其它文件头等）——hunk 结束
                }
            }
            if (consumedOldSide === 0 && !segments.some((s) => s.kind === "add")) {
                errors.push(`${filePatch.newPath ?? "?"} 存在空 hunk`);
            }
            filePatch.hunks.push({ oldStart, segments });
        }
        if (!filePatch.hunks.length && !errors.length) {
            errors.push(`${filePatch.newPath ?? "?"} 缺少 @@ hunk（不支持整文件包裹格式）`);
        }
        files.push(filePatch);
    }
    if (!files.length && !errors.length)
        errors.push("没有找到补丁内容（需要 unified diff 格式）");
    return { files, errors };
}
function hunkSides(hunk) {
    const expected = [];
    const replacement = [];
    let added = 0;
    let removed = 0;
    for (const seg of hunk.segments) {
        if (seg.kind === "add") {
            replacement.push(seg.text);
            added += 1;
        }
        else if (seg.kind === "context") {
            expected.push(seg.text);
            replacement.push(seg.text);
        }
        else {
            // remove：只进期望侧，不进重建结果
            expected.push(seg.text);
            removed += 1;
        }
    }
    return { expected, replacement, added, removed };
}
export function applyFilePatch(original, patch) {
    // —— 新建文件 —— //
    if (patch.oldPath === null) {
        if (original !== null)
            return { ok: false, error: `${patch.newPath} 标记为新建，但文件已存在` };
        const contentLines = patch.hunks.flatMap((h) => h.segments.filter((s) => s.kind === "add").map((s) => s.text));
        return { ok: true, content: contentLines.join("\n") + "\n", additions: contentLines.length, deletions: 0 };
    }
    if (patch.newPath === null) {
        return { ok: false, error: `apply_patch 不支持删除文件（${patch.oldPath}）：请改用 bash rm 后再提交补丁或保留文件` };
    }
    if (original === null) {
        return { ok: false, error: `文件不存在或不可读：${patch.oldPath}` };
    }
    // —— 修改现有文件：按 oldStart 从后往前应用，天然免行号漂移叠加 —— //
    const endedWithNewline = original.endsWith("\n");
    const work = original.split("\n");
    if (endedWithNewline)
        work.pop();
    let additions = 0;
    let deletions = 0;
    const ordered = [...patch.hunks].sort((a, b) => b.oldStart - a.oldStart);
    for (let h = 0; h < ordered.length; h++) {
        const hunk = ordered[h];
        const sides = hunkSides(hunk);
        const { expected, replacement } = sides;
        if (!expected.length) {
            // 纯新增块：oldStart 表示插入位置（其后行号）
            const insertAt = Math.max(0, Math.min(work.length, hunk.oldStart));
            work.splice(insertAt, 0, ...replacement);
            additions += replacement.length;
            void hunkSides;
            continue;
        }
        const idealPos = hunk.oldStart - 1;
        let foundAt = -1;
        for (let offset = 0; offset <= DRIFT_WINDOW && foundAt < 0; offset++) {
            for (const candidate of [idealPos + offset, idealPos - offset]) {
                if (candidate < 0 || candidate + expected.length > work.length)
                    continue;
                if (expected.every((line, i) => work[candidate + i] === line)) {
                    foundAt = candidate;
                    break;
                }
            }
        }
        if (foundAt < 0) {
            return {
                ok: false,
                error: `${patch.newPath} 第 ${h + 1} 个 hunk 无法应用：±${DRIFT_WINDOW} 行内找不到匹配上下文（期望首行「${expected[0]?.slice(0, 60)}」）`,
            };
        }
        work.splice(foundAt, expected.length, ...replacement);
        additions += sides.added;
        deletions += sides.removed;
    }
    const content = work.join("\n") + (work.length ? (endedWithNewline ? "\n" : "") : "");
    return { ok: true, content, additions, deletions };
}
async function commitPatches(patchText, ctx) {
    const { files, errors } = parseUnifiedPatch(patchText);
    const fatal = [...errors];
    const staged = [];
    for (const filePatch of files) {
        const target = filePatch.newPath ?? filePatch.oldPath ?? "?";
        if (fatal.length)
            break;
        const existing = await ctx.workspace.read(target);
        const outcome = applyFilePatch(existing ? existing.content : null, filePatch);
        if (!outcome.ok)
            fatal.push(outcome.error);
        else
            staged.push({ path: target, created: filePatch.oldPath === null, outcome });
    }
    if (fatal.length) {
        throw new Error(`补丁未应用任何变更（两阶段校验未通过）：\n${fatal.map((e) => `- ${e}`).join("\n")}`);
    }
    const reports = [];
    for (const entry of staged) {
        const written = await ctx.workspace.write({
            path: entry.path,
            content: entry.outcome.content,
            author: "agent",
            summary: `apply_patch 更新 ${entry.path}`,
        });
        if (!written)
            throw new Error(`写入被拒绝：${entry.path}`);
        await ctx.emitFileEdited({ path: entry.path, revisionId: written.revisionId, diff: written.diff });
        reports.push({
            path: entry.path,
            action: entry.created ? "created" : "updated",
            additions: entry.outcome.additions,
            deletions: entry.outcome.deletions,
            revisionId: written.revisionId,
        });
    }
    return {
        title: `apply_patch：${reports.length} 个文件`,
        output: reports.map((r) => `更新 ${r.path}（+${r.additions}/-${r.deletions}，版本 ${r.revisionId}）`).join("\n"),
        reports,
    };
}
function affectedPaths(patchText) {
    return [...patchText.matchAll(/^\+\+\+ (?:b\/)?([^\t\\\n]+)/gm)].map((m) => m[1]);
}
export const applyPatchTool = {
    id: "apply_patch",
    label: "应用补丁",
    description: "把 unified diff 补丁应用到 Workspace：一个补丁可改多个文件/多处 hunk，支持新建文件（--- /dev/null）；逐块上下文匹配允许 ±300 行漂移。任一文件校验失败则整体不变更。大范围结构化修改首选本工具。",
    parameters: z.object({
        patch: z.string().min(8).max(256 * 1024),
    }),
    permission: (args) => ({ permission: "edit", patterns: affectedPaths(args.patch) }),
    executionMode: "sequential",
    async execute(args, ctx) {
        const result = await commitPatches(args.patch, ctx);
        return { title: result.title, output: result.output, metadata: { files: result.reports } };
    },
};
//# sourceMappingURL=patch.js.map