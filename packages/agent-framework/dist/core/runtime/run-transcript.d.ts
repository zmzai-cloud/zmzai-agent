import type { AgentMessage } from "@earendil-works/pi-agent-core";
/** F6 自动重试时注入的合成 user 占位文本。run-transcript 提取时排除它，
 *  避免合成占位内容被当成真实用户发言存入长期记忆。 */
export declare const RETRY_PLACEHOLDER_TEXT = "\uFF08\u4E0A\u8F6E\u56DE\u590D\u751F\u6210\u4E2D\u65AD\uFF0C\u8BF7\u7EE7\u7EED\u5B8C\u6210\u56DE\u590D\u3002\uFF09";
/** 本次 run 新增的一条消息（只有 user/assistant 的纯文本部分）。 */
export type RunTranscriptMessage = {
    role: "user" | "assistant";
    text: string;
};
/** 提取一次 run 新增的可记忆内容：从 baselineCount 起切片，只保留
 *  user/assistant 的非空文本（thinking/toolCall/toolResult 一律跳过），
 *  排除 F6 合成占位。返回结果供宿主 hook retain 到长期记忆。 */
export declare function extractRunTranscript(messages: AgentMessage[], baselineCount: number): RunTranscriptMessage[];
//# sourceMappingURL=run-transcript.d.ts.map