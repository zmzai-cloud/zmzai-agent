"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge, Button, Card, Icon, Input, Navbar, Select as ThemeSelect, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@zmzai/theme";

type Automation = { automationId: string; workspaceId: string; projectId: string | null; sourceTaskId: string | null; name: string; goal: string; schedule: string; timezone: string; status: "active" | "paused"; lastRunAt: string | null; nextRunAt: string | null; lastRunStatus: string; lastError: string | null };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) throw new Error(body && typeof body === "object" && body !== null && "error" in body ? String(body.error) : "请求失败");
  return body as T;
}

const schedulePresets = ["手动运行", "每天 09:00", "工作日 09:00", "每小时", "*/15 * * * *"];

export default function AutomationEditPage() {
  const params = useParams<{ automationId: string }>();
  const router = useRouter();
  const automationId = params.automationId;
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [schedule, setSchedule] = useState("手动运行");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [status, setStatus] = useState<"active" | "paused">("active");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void json<{ automations: Automation[] }>("/api/automations").then((result) => {
      if (cancelled) return;
      const found = result.automations.find((item) => item.automationId === automationId);
      if (!found) { setError("自动化不存在"); return; }
      setAutomation(found);
      setName(found.name);
      setGoal(found.goal);
      setSchedule(found.schedule);
      setTimezone(found.timezone);
      setStatus(found.status);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载自动化");
    });
    return () => { cancelled = true; };
  }, [automationId]);

  const save = async () => {
    if (!name.trim() || !goal.trim() || busy) return;
    setBusy(true);
    setSaved(false);
    try {
      await json(`/api/automations/${encodeURIComponent(automationId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, goal, schedule, timezone, status }),
      });
      setSaved(true);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("删除此自动化？已运行的任务不受影响。")) return;
    setBusy(true);
    try {
      await json(`/api/automations/${encodeURIComponent(automationId)}`, { method: "DELETE" });
      router.push("/automations");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败"); setBusy(false); }
  };

  if (!automation && !error) return <main className="grid min-h-dvh place-items-center bg-bg"><p className="text-sm text-ink-3">正在加载自动化…</p></main>;

  return <main className="min-h-dvh bg-bg">
    <Navbar sublabel="agent" badge={<span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-3">a.zmzai.cloud</span>}>
      <Link href="/automations" className="text-xs text-ink-3 transition-colors hover:text-ink"><Icon name="arrow-left" size={12} className="mr-1 inline" />返回自动化</Link>
      <Link href="/fw" className="text-xs text-ink-3 transition-colors hover:text-ink">新对话</Link>
    </Navbar>
    <div className="mx-auto w-[min(100%-2rem,74rem)] py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <small className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-3">编辑自动化</small>
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{automation?.name ?? "自动化"}</h1>
          {automation?.lastRunAt && <p className="mt-1 text-sm text-ink-3">上次运行 {new Date(automation.lastRunAt).toLocaleString("zh-CN")}{automation.lastRunStatus ? ` · ${automation.lastRunStatus}` : ""}</p>}
        </div>
        <div className="flex items-center gap-2">
          {automation && <Badge variant={automation.status === "active" ? "success" : "outline"} size="sm">{automation.status === "active" ? "已启用" : "已暂停"}</Badge>}
        </div>
      </header>
      {error && <div className="mb-4 rounded-sm border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm text-ink" role="status">{error}</div>}
      {saved && <div className="mb-4 rounded-sm border-l-2 border-success bg-success/10 px-3 py-2 text-sm text-ink" role="status">已保存</div>}

      <Card padding="md" className="mb-6">
        <div className="flex flex-col gap-3">
          <label className="text-xs text-ink-3">自动化名称<Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" /></label>
          <label className="text-xs text-ink-3">执行目标<Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={4} className="mt-1" /></label>
          <div className="flex flex-wrap gap-3">
            <label className="min-w-[10rem] flex-1 text-xs text-ink-3">运行计划
              <Input value={schedule} list="edit-schedules" onChange={(event) => setSchedule(event.target.value)} className="mt-1" />
              <datalist id="edit-schedules">{schedulePresets.map((preset) => <option key={preset} value={preset} />)}</datalist>
            </label>
            <label className="min-w-[10rem] flex-1 text-xs text-ink-3">时区
              <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="mt-1" />
            </label>
            <label className="min-w-[8rem] text-xs text-ink-3">状态
              <ThemeSelect value={status} onValueChange={(value: string) => setStatus(value as "active" | "paused")}>
                <SelectTrigger className="mt-1 w-full" aria-label="状态"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">已启用</SelectItem>
                  <SelectItem value="paused">已暂停</SelectItem>
                </SelectContent>
              </ThemeSelect>
            </label>
          </div>
          <div className="flex items-center gap-2 border-t border-line pt-3">
            <Button type="button" onClick={() => void save()} disabled={busy || !name.trim() || !goal.trim()}><Icon name="check" size={13} />{busy ? "保存中" : "保存更改"}</Button>
            <Button type="button" variant="danger" onClick={() => void remove()} disabled={busy}><Icon name="trash" size={13} />删除</Button>
          </div>
        </div>
      </Card>
    </div>
  </main>;
}
