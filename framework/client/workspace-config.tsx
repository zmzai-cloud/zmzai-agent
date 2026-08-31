"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, Icon, Input, ModelSelector, Navbar, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, navItemClass, type ModelSelectorData, type ModelSelectorValue } from "@zmzai/theme";

type WorkspaceDetail = {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  approvalMode: "ask" | "auto" | "always";
  prompt: string;
  steps: number;
  skillIds: string[];
  pluginIds: string[];
};

type WorkspaceSkill = { id: string; name: string; description: string; repository: string; path: string };
type WorkspacePlugin = { id: string; name: string; description: string; version: string; skillCount: number; errors: string[] };
type WorkspaceBudget = { maxConcurrentRuns: number; monthlyTokenBudget: number; usedTokens: number; reservedRuns: number; usagePeriod: string };
type KnowledgeEntry = { entryId: string; title: string; content: string };
type UsageSummary = { inputTokens: number; outputTokens: number; cacheReadTokens: number; totalTokens: number; eventCount: number };
type UsageDaily = { date: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; totalTokens: number };
type UsageProject = { projectId: string; projectName: string; totalTokens: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; taskCount: number };
type UsageData = { summary: UsageSummary; daily: UsageDaily[]; byProject: UsageProject[] };
type MemoryStatus = { enabled: boolean; available: boolean; facts: number | null; isAdmin: boolean };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "请求失败");
  return body as T;
}

export function WorkspaceConfig({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [modelSelectorData, setModelSelectorData] = useState<ModelSelectorData | null>(null);
  const [modelValue, setModelValue] = useState<ModelSelectorValue>({ model: "" });
  const model = modelValue.model;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(12);
  const [approvalMode, setApprovalMode] = useState<"ask" | "auto">("ask");
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [plugins, setPlugins] = useState<WorkspacePlugin[]>([]);
  const [repository, setRepository] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [capabilityBusy, setCapabilityBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [budget, setBudget] = useState<WorkspaceBudget | null>(null);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [knowledgeBusy, setKnowledgeBusy] = useState<string | null>(null);
  const [newKbTitle, setNewKbTitle] = useState("");
  const [newKbContent, setNewKbContent] = useState("");
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [editKbTitle, setEditKbTitle] = useState("");
  const [editKbContent, setEditKbContent] = useState("");
  const [memory, setMemory] = useState<MemoryStatus | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const remove = useCallback(async () => {
    if (!detail || deleting) return;
    setDeleting(true);
    try {
      await json(`/api/workspaces/${encodeURIComponent(detail.id)}`, { method: "DELETE" });
      router.push("/fw");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
      setDeleting(false);
    }
  }, [detail, deleting, router]);

  const applyDetail = useCallback((ws: WorkspaceDetail) => {
    setDetail(ws);
    setName(ws.name);
    setDescription(ws.description);
    setPrompt(ws.prompt);
    setModelValue({ model: ws.defaultModel });
    setSteps(ws.steps);
    // 历史值 "always" 等同逐项审批，归入 ask 档显示。
    setApprovalMode(ws.approvalMode === "auto" ? "auto" : "ask");
  }, []);

  useEffect(() => {
    void Promise.all([
      json<{ workspace: WorkspaceDetail }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`).then((body) => applyDetail(body.workspace)),
      fetch("/api/models", { cache: "no-store" }).then((r) => r.ok ? r.json() as Promise<{ modelSelectorData: ModelSelectorData }> : Promise.reject(new Error("failed"))).then((body) => setModelSelectorData(body.modelSelectorData)),
      json<{ skills: WorkspaceSkill[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/skills`).then((body) => setSkills(body.skills)),
      json<{ plugins: WorkspacePlugin[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/plugins`).then((body) => setPlugins(body.plugins)),
      json<{ budget: WorkspaceBudget }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/budget`).then((body) => setBudget(body.budget)),
      json<{ knowledgeBase: KnowledgeEntry[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge`).then((body) => setKnowledge(body.knowledgeBase)),
      json<UsageData>(`/api/workspaces/${encodeURIComponent(workspaceId)}/usage`).then((body) => setUsage(body)).catch(() => { /* usage API optional */ }),
      json<{ memory: MemoryStatus }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/memory`).then((body) => setMemory(body.memory)).catch(() => { /* memory API optional */ }),
    ]).catch((cause) => setError(cause instanceof Error ? cause.message : "无法加载智能体配置"));
  }, [workspaceId, applyDetail]);

  const saveBudget = useCallback(async () => {
    if (!budget || budgetBusy) return;
    setBudgetBusy(true);
    setError(null);
    try {
      const result = await json<{ budget: WorkspaceBudget }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/budget`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxConcurrentRuns: budget.maxConcurrentRuns, monthlyTokenBudget: budget.monthlyTokenBudget }) });
      setBudget(result.budget);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存预算失败"); }
    finally { setBudgetBusy(false); }
  }, [budget, budgetBusy, workspaceId]);

  const addKnowledge = useCallback(async () => {
    if (!newKbTitle.trim() || !newKbContent.trim() || knowledgeBusy) return;
    setKnowledgeBusy("add");
    try {
      const result = await json<{ entry: KnowledgeEntry }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: newKbTitle.trim(), content: newKbContent.trim() }) });
      setKnowledge((current) => [result.entry, ...current]);
      setNewKbTitle("");
      setNewKbContent("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "添加失败"); }
    finally { setKnowledgeBusy(null); }
  }, [newKbTitle, newKbContent, knowledgeBusy, workspaceId]);

  const deleteKnowledge = useCallback(async (entryId: string) => {
    setKnowledgeBusy(entryId);
    try {
      await json(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge?entryId=${encodeURIComponent(entryId)}`, { method: "DELETE" });
      setKnowledge((current) => current.filter((entry) => entry.entryId !== entryId));
      if (editingKbId === entryId) setEditingKbId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { setKnowledgeBusy(null); }
  }, [workspaceId, editingKbId]);

  const saveKnowledgeEdit = useCallback(async (entryId: string) => {
    if (!editKbTitle.trim() || !editKbContent.trim()) return;
    setKnowledgeBusy(entryId);
    try {
      const result = await json<{ entry: KnowledgeEntry }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryId, title: editKbTitle.trim(), content: editKbContent.trim() }) });
      setKnowledge((current) => current.map((entry) => entry.entryId === entryId ? result.entry : entry));
      setEditingKbId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setKnowledgeBusy(null); }
  }, [editKbTitle, editKbContent, workspaceId]);

  const updateCapabilities = useCallback(async (patch: Partial<Pick<WorkspaceDetail, "skillIds" | "pluginIds">>) => {
    const body = await json<{ workspace: WorkspaceDetail }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    applyDetail(body.workspace);
  }, [applyDetail, workspaceId]);

  const toggleCapability = useCallback(async (kind: "skill" | "plugin", id: string, enabled: boolean) => {
    if (!detail) return;
    const key = `${kind}:${id}`;
    setCapabilityBusy(key);
    setError(null);
    try {
      const current = kind === "skill" ? detail.skillIds : detail.pluginIds;
      const ids = enabled ? [...current, id] : current.filter((value) => value !== id);
      await updateCapabilities(kind === "skill" ? { skillIds: ids } : { pluginIds: ids });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新能力失败");
    } finally {
      setCapabilityBusy(null);
    }
  }, [detail, updateCapabilities]);

  const importCapability = useCallback(async (kind: "skill" | "plugin") => {
    if (!repository.trim() || capabilityBusy) return;
    setCapabilityBusy(`import:${kind}`);
    setError(null);
    try {
      const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/${kind === "skill" ? "skills" : "plugins"}`;
      const payload = kind === "skill" ? { repository: repository.trim(), path: sourcePath.trim() } : { repository: repository.trim(), path: sourcePath.trim() };
      const result = await json<{ skill?: WorkspaceSkill; plugin?: WorkspacePlugin }>(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (kind === "skill" && result.skill) {
        setSkills((current) => current.some((item) => item.id === result.skill!.id) ? current : [result.skill!, ...current]);
        await updateCapabilities({ skillIds: detail?.skillIds.includes(result.skill.id) ? detail.skillIds : [...(detail?.skillIds ?? []), result.skill.id] });
      }
      if (kind === "plugin" && result.plugin) {
        setPlugins((current) => current.some((item) => item.id === result.plugin!.id) ? current : [result.plugin!, ...current]);
        await updateCapabilities({ pluginIds: detail?.pluginIds.includes(result.plugin.id) ? detail.pluginIds : [...(detail?.pluginIds ?? []), result.plugin.id] });
      }
      setRepository("");
      setSourcePath("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败");
    } finally {
      setCapabilityBusy(null);
    }
  }, [capabilityBusy, detail, repository, sourcePath, updateCapabilities, workspaceId]);

  const save = useCallback(async () => {
    if (!detail || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, prompt, steps, defaultModel: model, approvalMode, skillIds: detail.skillIds, pluginIds: detail.pluginIds }),
      });
      const body = (await response.json()) as { workspace?: WorkspaceDetail; error?: string };
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      if (body.workspace) applyDetail(body.workspace);
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [detail, saving, workspaceId, name, description, prompt, model, steps, approvalMode, applyDetail]);

  if (!detail) return <main className="workbench-loading">{error ?? "加载中…"}</main>;

  return (
    <main className="agent-workbench">
      <Navbar
        sublabel="agent"
        badge={<span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-3">a.zmzai.cloud</span>}
        actions={<span className="flex items-center gap-2 text-sm text-ink-2"><span className="status-dot" />智能体配置</span>}
      >
        <Link href="/fw" className={navItemClass(pathname === "/fw")}>任务</Link>
        <Link href="/audit" className={navItemClass(pathname === "/audit")}>运行审计</Link>
        <Link href="/runs" className={navItemClass(pathname === "/runs" || pathname?.startsWith("/runs/"))}>运行历史</Link>
        <Link href="/webhooks" className={navItemClass(pathname === "/webhooks")}>Webhook</Link>
      </Navbar>
      {error && <div className="workbench-alert">{error}</div>}

      <div className="agent-config-grid">
        <section className="agent-config-editor">
          <div className="agent-config-titlebar">
            <div><span className="eyebrow">智能体配置</span><h1 className="font-serif">{detail.name}</h1></div>
            <div className="agent-config-actions">
              {savedAt && <span className="agent-saved-hint">已保存 {savedAt}</span>}
              <button type="button" className="command-button quiet" onClick={() => void save()} disabled={saving}>{saving ? "保存中" : "保存配置"}</button>
            </div>
          </div>
          <div className="agent-form">
            <label><span>名称</span><Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>描述</span><Input value={description} maxLength={2_000} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="agent-form-row">
              <label><span>默认模型</span><ModelSelector data={modelSelectorData ?? { featured: [], channels: [] }} value={modelValue} onChange={setModelValue} placeholder="跟随任务选择" /></label>
              <label>
                <span>自治档位</span>
                <Select value={approvalMode} onValueChange={(value) => setApprovalMode(value === "auto" ? "auto" : "ask")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">逐项确认</SelectItem>
                    <SelectItem value="auto">自动执行</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label><span>最大步骤</span><Input type="number" min="1" max="64" value={steps} onChange={(event) => setSteps(Math.min(64, Math.max(1, Number(event.target.value) || 1)))} /></label>
            </div>
            <p className="agent-approval-hint">{approvalMode === "auto" ? "自动执行：任务内的命令不再逐项询问，适合可信任的沙箱任务。" : "逐项确认：执行命令前会弹出审批，可随时在会话中放行。"}</p>
            <label className="agent-prompt-label"><span>系统提示词（AGENT.md）</span><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} spellCheck={false} rows={10} /></label>
          </div>
        </section>

        <aside className="agent-config-meta">
          <section className="agent-version-panel">
            <span className="eyebrow">智能体</span>
            <strong>{detail.name}</strong>
            <small>创建于 {new Date(detail.id ? "" : "").toLocaleDateString("zh-CN") || "—"}</small>
          </section>
          {budget && <section className="mt-5 rounded-sm border border-line bg-surface p-4">
            <div className="mb-3 flex items-center justify-between"><div><span className="eyebrow">运行预算</span><strong className="mt-1 block text-ink">Workspace 限制</strong></div><span className="font-mono text-xs text-ink-3">{budget.usagePeriod}</span></div>
            <div className="mb-3 flex flex-wrap gap-2"><label className="text-xs text-ink-3">最大并发<Input type="number" min="1" max="64" value={budget.maxConcurrentRuns} onChange={(event) => setBudget((current) => current ? { ...current, maxConcurrentRuns: Math.min(64, Math.max(1, Number(event.target.value) || 1)) } : current)} className="mt-1 w-28" /></label><label className="text-xs text-ink-3">月度 Token 上限<Input type="number" min="0" max="1000000000" value={budget.monthlyTokenBudget} onChange={(event) => setBudget((current) => current ? { ...current, monthlyTokenBudget: Math.min(1_000_000_000, Math.max(0, Number(event.target.value) || 0)) } : current)} className="mt-1 w-40" /></label></div>
            <div className="mb-3 flex flex-wrap gap-3 font-mono text-xs text-ink-3"><span>本月已用 <strong className="font-sans text-sm text-ink">{budget.usedTokens.toLocaleString()}</strong></span><span>当前运行 <strong className="font-sans text-sm text-ink">{budget.reservedRuns}</strong></span></div>
            <Button type="button" size="sm" variant="secondary" disabled={budgetBusy} onClick={() => void saveBudget()}><Icon name="check" size={13} />{budgetBusy ? "保存中" : "保存预算"}</Button>
            <small className="mt-2 block text-xs leading-relaxed text-ink-3">月度上限为 0 表示不限制。项目预算仍可设置更严格的限制。</small>
          </section>}
          {usage && <UsageDashboard usage={usage} monthlyBudget={budget?.monthlyTokenBudget ?? 0} />}
          <section className="mt-5 border-t border-line pt-4 text-sm">
            <div className="mb-3"><div className="flex items-center justify-between"><div><span className="eyebrow">知识库</span><strong className="mt-1 block text-ink">Workspace 背景知识</strong></div><span className="font-mono text-xs text-ink-3">{knowledge.length} 条</span></div><small className="block text-xs text-ink-3">Agent 运行时自动注入，补充 API 规范、编码规范、业务术语等。</small></div>
            <div className="space-y-2">
              {knowledge.map((entry) => (
                <div key={entry.entryId} className="rounded-sm border border-line p-2">
                  {editingKbId === entry.entryId ? (
                    <div className="flex flex-col gap-1.5">
                      <Input value={editKbTitle} onChange={(event) => setEditKbTitle(event.target.value)} placeholder="标题" className="text-xs" />
                      <Textarea value={editKbContent} onChange={(event) => setEditKbContent(event.target.value)} placeholder="内容" rows={4} className="font-mono text-xs" />
                      <div className="flex gap-1.5"><Button type="button" size="sm" disabled={knowledgeBusy === entry.entryId} onClick={() => void saveKnowledgeEdit(entry.entryId)}>保存</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditingKbId(null)}>取消</Button></div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setEditingKbId(entry.entryId); setEditKbTitle(entry.title); setEditKbContent(entry.content); }}>
                        <strong className="block truncate text-xs text-ink">{entry.title}</strong>
                        <small className="mt-0.5 block truncate text-ink-3">{entry.content.slice(0, 120)}</small>
                      </button>
                      <button type="button" className="shrink-0 rounded-sm p-1 text-ink-3 transition-colors hover:bg-line hover:text-danger" disabled={knowledgeBusy === entry.entryId} aria-label={`删除 ${entry.title}`} onClick={() => void deleteKnowledge(entry.entryId)}><Icon name="trash" size={11} /></button>
                    </div>
                  )}
                </div>
              ))}
              {!knowledge.length && <p className="text-xs text-ink-3">还没有知识条目。</p>}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Input value={newKbTitle} onChange={(event) => setNewKbTitle(event.target.value)} placeholder="条目标题（如：API 命名规范）" aria-label="知识标题" className="text-xs" />
              <Textarea value={newKbContent} onChange={(event) => setNewKbContent(event.target.value)} placeholder="知识内容（如：所有 REST API 使用 camelCase 命..." rows={3} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="secondary" disabled={!newKbTitle.trim() || !newKbContent.trim() || Boolean(knowledgeBusy)} onClick={() => void addKnowledge()}><Icon name="plus" size={13} />{knowledgeBusy === "add" ? "添加中" : "添加知识"}</Button>
            </div>
          </section>
          {memory && (
            <section className="mt-5 border-t border-line pt-4 text-sm">
              <button type="button" className="flex w-full items-center justify-between text-left" aria-expanded={memoryOpen} onClick={() => setMemoryOpen((open) => !open)}>
                <div><span className="eyebrow">自动记忆</span><strong className="mt-1 block text-ink">会话经验长期沉淀</strong></div>
                <span className="font-mono text-xs text-ink-3">{memory.enabled ? (memory.facts === null ? "—" : `${memory.facts} 条`) : "未启用"}</span>
              </button>
              {memoryOpen && (
                <div className="mt-3 space-y-2 text-xs text-ink-3">
                  <p>Agent 自动把每次任务的经验沉淀到长期记忆，并在后续任务开始时按相关性召回注入，无需手动维护。</p>
                  <p>状态：{memory.enabled ? (memory.available ? "已连接，正常工作中" : "已配置但服务不可用") : "未配置记忆服务"}</p>
                  {memory.isAdmin && memory.available && (
                    <div className="rounded-sm border border-line p-2 font-mono text-[11px] leading-relaxed">
                      <p className="mb-1 font-sans text-ink-2">管理员：本地查看记忆库</p>
                      <p>ssh -L 9999:127.0.0.1:9999 &lt;host&gt;</p>
                      <p>打开 http://127.0.0.1:9999 ，bank 为 {workspaceId}</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          <section className="mt-5 border-t border-line pt-4 text-sm">
            <div className="mb-3 flex items-center justify-between"><div><span className="eyebrow">可用能力</span><strong className="mt-1 block text-ink">Skills 与 Plugins</strong></div><span className="font-mono text-xs text-ink-3">{detail.skillIds.length + detail.pluginIds.length} 已启用</span></div>
            <div className="space-y-2">
              {skills.map((skill) => <label className="flex cursor-pointer items-start gap-2 border-b border-line pb-2" key={skill.id}><input className="mt-1" type="checkbox" checked={detail.skillIds.includes(skill.id)} disabled={capabilityBusy === `skill:${skill.id}`} onChange={(event) => void toggleCapability("skill", skill.id, event.target.checked)} /><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-ink">{skill.name}</strong><small className="block truncate text-ink-3">{skill.description || `${skill.repository}/${skill.path}`}</small></span></label>)}
              {plugins.map((plugin) => <label className="flex cursor-pointer items-start gap-2 border-b border-line pb-2" key={plugin.id}><input className="mt-1" type="checkbox" checked={detail.pluginIds.includes(plugin.id)} disabled={capabilityBusy === `plugin:${plugin.id}`} onChange={(event) => void toggleCapability("plugin", plugin.id, event.target.checked)} /><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-ink">{plugin.name}</strong><small className="block truncate text-ink-3">Plugin · {plugin.skillCount} Skills{plugin.version ? ` · v${plugin.version}` : ""}</small></span></label>)}
              {!skills.length && !plugins.length && <p className="text-xs text-ink-3">还没有导入能力。</p>}
            </div>
            <div className="mt-3 grid gap-2"><Input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repository" aria-label="GitHub 仓库" /><Input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="Skill 或 Plugin 路径" aria-label="仓库路径" /><div className="flex gap-2"><Button type="button" size="sm" variant="secondary" disabled={!repository.trim() || !sourcePath.trim() || Boolean(capabilityBusy)} onClick={() => void importCapability("skill")}>导入 Skill</Button><Button type="button" size="sm" variant="secondary" disabled={!repository.trim() || Boolean(capabilityBusy)} onClick={() => void importCapability("plugin")}>导入 Plugin</Button></div></div>
          </section>
          <button type="button" className="agent-back-button" onClick={() => router.push("/fw")}><Icon name="arrow-down" size={12} />返回任务</button>
          <div className="mt-6 border-t border-line pt-4">
            {confirmDelete ? (
              <div className="flex flex-col gap-2 text-sm text-ink-2">
                <span>删除后会话、产物、文件版本全部清除，不可恢复。</span>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="danger" size="sm" disabled={deleting} onClick={() => void remove()}>{deleting ? "删除中…" : "确认删除"}</Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>取消</Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="font-mono text-xs text-danger underline" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={12} />删除此智能体
              </Button>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function UsageDashboard({ usage, monthlyBudget }: { usage: UsageData; monthlyBudget: number }) {
  const { summary, daily, byProject } = usage;
  const maxDaily = Math.max(...daily.map((d) => d.totalTokens), 1);
  const budgetPct = monthlyBudget > 0 ? Math.min(100, Math.round((summary.totalTokens / monthlyBudget) * 100)) : 0;

  return (
    <section className="mt-5 rounded-sm border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div><span className="eyebrow">用量分析</span><strong className="mt-1 block text-ink">近 30 天</strong></div>
        <span className="font-mono text-xs text-ink-3">{summary.eventCount} 次调用</span>
      </div>

      {/* Summary stats */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-sm border border-line p-2">
          <div className="text-[10px] uppercase tracking-wide text-ink-3">总 Tokens</div>
          <div className="font-mono text-sm text-ink">{fmtCount(summary.totalTokens)}</div>
        </div>
        <div className="rounded-sm border border-line p-2">
          <div className="text-[10px] uppercase tracking-wide text-ink-3">缓存命中</div>
          <div className="font-mono text-sm text-ink">{fmtCount(summary.cacheReadTokens)}</div>
        </div>
        <div className="rounded-sm border border-line p-2">
          <div className="text-[10px] uppercase tracking-wide text-ink-3">输入</div>
          <div className="font-mono text-sm text-ink">{fmtCount(summary.inputTokens)}</div>
        </div>
        <div className="rounded-sm border border-line p-2">
          <div className="text-[10px] uppercase tracking-wide text-ink-3">输出</div>
          <div className="font-mono text-sm text-ink">{fmtCount(summary.outputTokens)}</div>
        </div>
      </div>

      {/* Budget gauge */}
      {monthlyBudget > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-ink-3">
            <span>预算使用</span>
            <span>{budgetPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full transition-all ${budgetPct > 90 ? "bg-danger" : budgetPct > 70 ? "bg-warning" : "bg-success"}`} style={{ width: `${budgetPct}%` }} />
          </div>
        </div>
      )}

      {/* Daily trend chart */}
      {daily.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">每日用量</div>
          <div className="usage-chart">
            {daily.map((day) => (
              <div key={day.date} className="usage-chart-bar" title={`${day.date}: ${fmtCount(day.totalTokens)} tokens`}>
                <div className="usage-bar-segment usage-bar-input" style={{ height: `${(day.inputTokens / maxDaily) * 100}%` }} />
                <div className="usage-bar-segment usage-bar-output" style={{ height: `${(day.outputTokens / maxDaily) * 100}%` }} />
                <div className="usage-bar-segment usage-bar-cache" style={{ height: `${(day.cacheReadTokens / maxDaily) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-3 text-[10px] text-ink-3">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--color-muted)]" />输入</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--color-accent)]" />输出</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--color-success)]" />缓存</span>
          </div>
        </div>
      )}

      {/* Project breakdown */}
      {byProject.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">按项目</div>
          <div className="space-y-1.5">
            {byProject.map((project) => (
              <div key={project.projectId} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-ink">{project.projectName}</span>
                <span className="shrink-0 font-mono text-ink-3">{fmtCount(project.totalTokens)}</span>
                <div className="w-16 shrink-0 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (project.totalTokens / (byProject[0]?.totalTokens || 1)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!daily.length && !byProject.length && <p className="text-xs text-ink-3">近 30 天没有用量数据。</p>}
    </section>
  );
}
