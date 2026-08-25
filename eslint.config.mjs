import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // react-hooks v6 新增规则：effect 内同步 setState 会引发级联渲染。
      // 既有代码（初始加载态 setLoading 等模式）尚未迁移，降为警告保留可见性。
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "out/**", "packages/agent-framework/dist/**"]),
]);
