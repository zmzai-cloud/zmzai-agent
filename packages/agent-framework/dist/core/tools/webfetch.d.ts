import type { ToolDef } from "../tools/def.js";
export declare function isPrivateHost(hostname: string): boolean;
/** 把 HTML 粗略转成纯文本：去 script/style、块级标签换行、超链接保留目标。
 *  不追求精确——webfetch 的目标是让模型拿到可读内容，不是渲染网页。 */
export declare function htmlToText(html: string): string;
/** webfetch（spec §7.2）：抓取公网 URL 并转为文本。v0 experimental：
 *  白名单域可后续在工具参数或产品配置层收紧，目前只有 SSRF 防护 +
 *  大小/超时上限。 */
export declare const webfetchTool: ToolDef;
//# sourceMappingURL=webfetch.d.ts.map