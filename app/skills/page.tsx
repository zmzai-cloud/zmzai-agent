"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, Button, Card, EmptyState, Icon, IconButton, Input, PageHeader, Select as ThemeSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@zmzai/theme";
import { LoginGate, useLoggedIn, WorkbenchRail } from "@/framework/client/workbench-rail";

type Skill = { id: string; name: string; description: string; repository: string; requestedRef: string; commitSha: string; path: string; workspaceId: string; workspaceName: string; source: "task" | "github"; markdown: string; createdAt: string };
type Workspace = { id: string; name: string };
type TrustedSkill = { id: string; publisher: string; repository: string; ref: string; path: string; name: string; description: string };
type Preview = { skill: { repository: string; requestedRef: string; commitSha: string; path: string; name: string; description: string; markdown: string }; reviewToken: string; expiresAt: string };

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
  const [discoveryWorkspaceId, setDiscoveryWorkspaceId] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalog, setCatalog] = useState<TrustedSkill[]>([]);
  const [repository, setRepository] = useState("");
  const [ref, setRef] = useState("main");
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let cancelled = false;
    void json<{ workspaces: Workspace[] }>("/api/workspaces").then((result) => {
      if (!cancelled) {
        setWorkspaces(result.workspaces);
        setDiscoveryWorkspaceId((current) => current || result.workspaces[0]?.id || "");
      }
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

  useEffect(() => {
    if (!discoveryWorkspaceId) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void json<{ skills: TrustedSkill[] }>(`/api/workspaces/${encodeURIComponent(discoveryWorkspaceId)}/skill-discovery?q=${encodeURIComponent(catalogQuery)}`).then((result) => {
        if (!cancelled) setCatalog(result.skills);
      }).catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载可信 Skill 目录");
      });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [discoveryWorkspaceId, catalogQuery]);

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

  const previewCoordinates = async (coordinates: Pick<TrustedSkill, "repository" | "ref" | "path">) => {
    if (!discoveryWorkspaceId) { setError("请先选择要导入到的 Workspace"); return; }
    setBusy("preview");
    setError(null);
    try {
      const result = await json<Preview>(`/api/workspaces/${encodeURIComponent(discoveryWorkspaceId)}/skill-discovery/preview`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(coordinates),
      });
      setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法预览 GitHub Skill"); }
    finally { setBusy(null); }
  };

  const importPreview = async () => {
    if (!preview || !discoveryWorkspaceId) return;
    setBusy("import");
    setError(null);
    try {
      const result = await json<{ skill: { id: string }; reused: boolean }>(`/api/workspaces/${encodeURIComponent(discoveryWorkspaceId)}/skills`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewToken: preview.reviewToken, markdown: preview.skill.markdown }),
      });
      const reloaded = await json<{ skills: Skill[] }>(`/api/skills${workspaceId === "__all__" ? "" : `?workspaceId=${encodeURIComponent(workspaceId)}`}`);
      setSkills(reloaded.skills);
      setRefreshMsg({ id: result.skill.id, text: result.reused ? "该固定版本已在此 Workspace 中" : `已导入到 ${workspaces.find((item) => item.id === discoveryWorkspaceId)?.name ?? "Workspace"}` });
      setPreview(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败"); }
    finally { setBusy(null); }
  };

  const { loggedIn, loading } = useLoggedIn();
  if (!loading && !loggedIn) return <LoginGate title="登录后管理 Skill" />;

  return <main className="flex min-h-dvh flex-col bg-bg md:flex-row">
    <WorkbenchRail tasks={[]} activeTaskId={null} onNew={() => { window.location.href = "/quill"; }} onOpen={() => undefined} />
    <div className="flex min-w-0 flex-1 flex-col">
    <div className="mx-auto flex w-[min(100%-2rem,74rem)] flex-1 flex-col py-8">
      <PageHeader
        icon="sparkle"
        eyebrow="可复用指令"
        title="Skill"
        description="从 GitHub 导入或从成功任务保存的可复用执行指令。"
        actions={
          <Link href="/quill"><Button variant="secondary" size="sm">新对话 <Icon name="arrow-up-right" size={14} /></Button></Link>
        }
        className="mb-6"
      />
      {error && <div className="mb-4 rounded-sm border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm text-ink" role="status">{error}</div>}

      <Card padding="md" className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">从 GitHub 发现 Skill</h2>
            <p className="mt-1 text-sm text-ink-2">先审阅固定提交的 <code>SKILL.md</code>，再导入。公开 GitHub 仓库仅；第三方内容可能请求工具或文件操作。</p>
          </div>
          <ThemeSelect value={discoveryWorkspaceId} onValueChange={(value: string) => { setDiscoveryWorkspaceId(value); setPreview(null); }}>
            <SelectTrigger className="w-auto" aria-label="选择导入 Workspace"><SelectValue placeholder="选择 Workspace" /></SelectTrigger>
            <SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
          </ThemeSelect>
        </div>
        {!workspaces.length ? <p className="mt-3 text-sm text-ink-3">先创建 Workspace，才能导入 Skill。</p> : <>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-ink-2">可信来源目录</label>
              <Input className="mt-1" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="搜索 OpenAI、Anthropic Skill" aria-label="搜索可信 Skill" />
              <div className="mt-2 flex max-h-60 flex-col gap-2 overflow-auto">
                {catalog.map((item) => <button key={item.id} type="button" className="rounded-sm border border-border bg-surface px-3 py-2 text-left hover:border-accent/60" onClick={() => void previewCoordinates(item)} disabled={busy === "preview"}>
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-ink">{item.name}</span><Badge variant="outline" size="sm">{item.publisher}</Badge></span>
                  <span className="mt-0.5 block text-xs text-ink-3">{item.description}</span>
                </button>)}
                {!catalog.length && <p className="px-1 py-2 text-sm text-ink-3">没有匹配的可信目录项。</p>}
              </div>
            </div>
            <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void previewCoordinates({ repository, ref, path }); }}>
              <label className="text-xs font-medium text-ink-2">从公开 GitHub 仓库预览</label>
              <Input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repository 或 GitHub URL" required aria-label="GitHub 仓库" />
              <div className="grid grid-cols-3 gap-2"><Input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="ref" required aria-label="GitHub ref" /><Input className="col-span-2" value={path} onChange={(event) => setPath(event.target.value)} placeholder="包含 SKILL.md 的目录，例如 skills/pdf" required aria-label="Skill 目录" /></div>
              <Button type="submit" size="sm" variant="secondary" disabled={busy === "preview" || !discoveryWorkspaceId}>{busy === "preview" ? "正在读取…" : "预览固定版本"}</Button>
            </form>
          </div>
          {preview && <div className="mt-4 rounded-sm border border-accent/40 bg-accent/5 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium text-ink">{preview.skill.name}</h3><p className="mt-1 text-xs text-ink-3">{preview.skill.repository}@{preview.skill.commitSha.slice(0, 7)} · {preview.skill.path} · 预览至 {new Date(preview.expiresAt).toLocaleTimeString("zh-CN")}</p></div><Button size="sm" disabled={busy === "import"} onClick={() => void importPreview()}>{busy === "import" ? "正在导入…" : "导入此固定版本"}</Button></div>
            {preview.skill.description && <p className="mt-2 text-sm text-ink-2">{preview.skill.description}</p>}
            <pre className="mt-3 max-h-80 overflow-auto rounded-sm border border-border bg-surface p-3 font-mono text-xs whitespace-pre-wrap text-ink-2">{preview.skill.markdown}</pre>
          </div>}
        </>}
      </Card>

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
