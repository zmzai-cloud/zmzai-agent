import type { SessionStore } from "./store.js";
/** SQLite SessionStore (N4)：单文件、零依赖（Node 26 内置 node:sqlite）的本地
 *  持久化后端，替代 JSONL 的多文件整文档写。记录以 JSON 文本整行存储（schema
 *  轻量，与 SessionStore 的 document 语义对齐），排序/过滤所需的列单独提取。
 *
 *  Layout: <dataDir>/zmzai.db — sessions/messages/parts 三张表。
 *  首次初始化时若存在旧 JSONL 数据（sessions/*.json 等）且库为空，则一次性
 *  导入；JSONL 文件保留不动，删除 dataDir/zmzai.db 即可回退。
 *  并发（P0）：WAL journal 模式 + busy_timeout，允许 dev server 多 worker /
 *  CLI 与 Web 同时打开同一库文件（写写冲突由 busy_timeout 排队而非报错）。 */
type SqliteStoreOptions = {
    dataDir: string;
    /** 旧 JSONL 数据自动导入（默认开启，库非空时跳过）。 */
    importJsonl?: boolean;
};
export declare function createSqliteSessionStore(options: SqliteStoreOptions): SessionStore;
export {};
//# sourceMappingURL=sqlite-store.d.ts.map