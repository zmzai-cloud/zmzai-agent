"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, Button, Card, EmptyState, Icon, IconButton, Input, Select as ThemeSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@zmzai/theme";
import { LoginGate, useLoggedIn, WorkbenchRail } from "@/framework/client/workbench-rail";

type Skill = { id: string; name: string; description: string; repository: string; requestedRef: string; commitSha: string; path: string; workspaceId: string; workspaceName: string; source: "task" | "github"; markdown: string; createdAt: string };
type Workspace = { id: string; name: string };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) throw new Error(body && typeof body === "object" && body !== null && "error" in body ? String(body.error) : "请求失败");
  return body as T;
}

function sourceLabel(source: Skill["source"]) { return source === "task" ? "任务保存" : "GitHub 导入"; }
function sourceVariant(source: Skill["source"]) { return source === "task" ? "accent" as const : "outline" as const; }

export default function SkillsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workspaceId, setWorkspaceId] = useState("__all__");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMarkdown, setEditMarkdown] = useState("");
  const [editName, setEditName] = useState("");
  const [refreshMsg, setRefreshMsg] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void json<{ workspaces: Workspace[] }>("/api/workspaces").then((result) => {
      if (!cancelled) setWorkspaces(result.workspaces);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载 Workspace");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const query = workspaceId === "__all__" ? "" : `?workspaceId=${encodeURIComponent(workspaceId)}`;
    void json<{ skills: Skill[] }>(`/api/skills${query}`).then((result) => {
      if (!cancelled) setSkills(result.skills);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载 Skill");
    });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const remove = async (skill: Skill) => {
    if (!window.confirm(`删除 Skill "${skill.name}"？关联的自动化仍可运行但不再引用此 Skill。`)) return;
    setBusy(skill.id);
    try {
      await json(`/api/workspaces/${encodeURIComponent(skill.workspaceId)}/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" });
      setSkills((items) => items.filter((item) => item.id !== skill.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { setBusy(null); }
  };

  const startEdit = (skill: Skill) => {
    setEditingId(skill.id);
    setEditName(skill.name);
    setEditMarkdown(skill.markdown);
  };

  const saveEdit = async (skill: Skill) => {
    setBusy(skill.id);
    try {
      const result = await json<{ skill: { id: string; name: string; description: string; markdown: string; commitSha: string } }>(
        `/api/workspaces/${encodeURIComponent(skill.workspaceId)}/skills/${encodeURIComponent(skill.id)}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: editName, markdown: editMarkdown }) },
      );
      setSkills((items) => items.map((item) => item.id === skill.id ? { ...item, name: result.skill.name, markdown: result.skill.markdown, commitSha: result.skill.commitSha } : item));
      setEditingId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(null); }
  };

  const refreshSkill = async (skill: Skill) => {
    setBusy(skill.id);
    setRefreshMsg(null);
    try {
      const result = await json<{ updated: boolean; oldSha?: string; newSha?: string; currentSha?: string }>(
        `/api/workspaces/${encodeURIComponent(skill.workspaceId)}/skills/${encodeURIComponent(skill.id)}/refresh`,
        { method: "POST" },
      );
      if (result.updated) {
        setRefreshMsg({ id: skill.id, text: `已更新 ${result.oldSha?.slice(0, 7)} → ${result.newSha?.slice(0, 7)}` });
        // Reload skills to get the new record
        const query = workspaceId === "__all__" ? "" : `?workspaceId=${encodeURIComponent(workspaceId)}`;
        const reloaded = await json<{ skills: Skill[] }>(`/api/skills${query}`);
        setSkills(reloaded.skills);
      } else {
        setRefreshMsg({ id: skill.id, text: `已是最新 (${(result.currentSha ?? skill.commitSha).slice(0, 7)})` });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "刷新失败"); }
    finally { setBusy(null); }
  };

  const { loggedIn, loading } = useLoggedIn();
  if (!loading && !loggedIn) return <LoginGate title="登录后管理 Skill" />;

  return <main className="flex min-h-dvh flex-col bg-bg md:flex-row">
    <WorkbenchRail tasks={[]} activeTaskId={null} onNew={() => { window.location.href = "/fw"; }} onOpen={() => undefined} />
    <div className="flex min-w-0 flex-1 flex-col">
    <div className="mx-auto flex w-[min(100%-2rem,74rem)] flex-1 flex-col py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <small className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-3">可复用指令</small>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">Skill</h1>
          <p className="mt-1 text-sm text-ink-3">从 GitHub 导入或从成功任务保存的可复用执行指令。</p>
        </div>
        <Link href="/fw"><Button variant="secondary" size="sm">新对话 <Icon name="arrow-up-right" size={14} /></Button></Link>
      </header>
      {error && <div className="mb-4 rounded-sm border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm text-ink" role="status">{error}</div>}

      <Card padding="sm" className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <ThemeSelect value={workspaceId} onValueChange={(value: string) => setWorkspaceId(value)}>
            <SelectTrigger className="w-auto" aria-label="按 Workspace 筛选"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">所有 Workspace</SelectItem>
              {workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}
            </SelectContent>
          </ThemeSelect>
          <Badge variant="outline" size="sm">{skills.length} 个 Skill</Badge>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        {skills.length ? skills.map((skill) => (
          <Card key={skill.id} padding="md">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-ink">{skill.name}</h2>
                  <Badge variant={sourceVariant(skill.source)} size="sm">{sourceLabel(skill.source)}</Badge>
                  <small className="font-mono text-xs text-ink-3">{skill.workspaceName}</small>
                </div>
                {skill.description && <p className="mt-1 text-sm text-ink-2">{skill.description}</p>}
                <small className="mt-1 block text-xs text-ink-3">
                  {skill.source === "github" ? `${skill.repository}@${skill.commitSha.slice(0, 7)}` : `任务 ${skill.requestedRef}`}
                  {" · "}{new Date(skill.createdAt).toLocaleDateString("zh-CN")}
                </small>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {skill.source === "task" ? (
                  <Button size="sm" variant="secondary" disabled={busy === skill.id} onClick={() => editingId === skill.id ? void saveEdit(skill) : startEdit(skill)}>
                    <Icon name={editingId === skill.id ? "check" : "pencil"} size={13} /> {editingId === skill.id ? "保存" : "编辑"}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busy === skill.id} onClick={() => void refreshSkill(skill)}>
                    <Icon name="refresh-cw" size={13} /> 检查更新
                  </Button>
                )}
                <IconButton size="md" label={`删除 ${skill.name}`} disabled={busy === skill.id} onClick={() => void remove(skill)}><Icon name="trash" size={13} /></IconButton>
              </div>
            </div>
            {refreshMsg && refreshMsg.id === skill.id && (
              <div className="mt-2 rounded-sm border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs text-accent">{refreshMsg.text}</div>
            )}
            {editingId === skill.id ? (
              <div className="mt-3 flex flex-col gap-2">
                <label className="text-xs font-medium text-ink-2">名称
                  <input className="mt-1 w-full rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent" value={editName} onChange={(event) => setEditName(event.target.value)} />
                </label>
                <label className="text-xs font-medium text-ink-2">Markdown 内容
                  <textarea className="mt-1 h-64 w-full resize-y rounded-sm border border-border bg-surface px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent" value={editMarkdown} onChange={(event) => setEditMarkdown(event.target.value)} />
                </label>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy === skill.id} onClick={() => void saveEdit(skill)}>保存</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>取消</Button>
                </div>
              </div>
            ) : (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-ink-3 hover:text-ink-2">预览 Markdown 内容</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-sm border border-border bg-surface p-3 font-mono text-xs whitespace-pre-wrap text-ink-2">{skill.markdown}</pre>
              </details>
            )}
          </Card>
        )) : <EmptyState icon={<Icon name="zap" size={24} />} title="还没有 Skill" description="从 GitHub 导入或把成功任务保存为 Skill。" />}
      </section>
    </div>
    </div>
  </main>;
}
