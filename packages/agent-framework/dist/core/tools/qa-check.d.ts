import { z } from "zod";
import type { ToolDef } from "./def.js";
export declare const qaCheckResultSchema: z.ZodObject<{
    version: z.ZodLiteral<"v1">;
    status: z.ZodEnum<{
        failed: "failed";
        passed: "passed";
    }>;
    checks: z.ZodArray<z.ZodObject<{
        id: z.ZodEnum<{
            html_loads: "html_loads";
            metrics_present: "metrics_present";
            desktop_viewport: "desktop_viewport";
            mobile_viewport: "mobile_viewport";
        }>;
        status: z.ZodEnum<{
            failed: "failed";
            passed: "passed";
        }>;
        message: z.ZodString;
    }, z.core.$strip>>;
    viewports: z.ZodArray<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
        overflow: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type QaCheckResult = z.infer<typeof qaCheckResultSchema>;
export declare const qaCheckTool: ToolDef;
//# sourceMappingURL=qa-check.d.ts.map