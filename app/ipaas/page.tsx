"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, EmptyState, Icon, IconButton, Input, Select as ThemeSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@zmzai/theme";
import { LoginGate, useLoggedIn, WorkbenchRail } from "@/framework/client/workbench-rail";

type Workspace = { id: string; name: string };
type IpaasPlatform = "feishu" | "email" | "webhook";
type ConnectorStatus = "active" | "paused";
type Connector = {
  connectorId: string;
  workspaceId: string;
  platform: IpaasPlatform;
  name: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  linkedAutomationId: string | null;
  status: ConnectorStatus;
  lastActivityAt: string | null;
  lastError: string | null;
  createdAt: string;
};

const platformLabels: Record<IpaasPlatform, string> = {
  feishu: "飞书",
  email: "邮件",
  webhook: "Webhook",
};

const platformIcons: Record<IpaasPlatform, string> = {
  feishu: "message-circle",
  email: "mail",
  webhook: "globe",
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) throw new Error(body && typeof body === "object" && body !== null && "error" in body ? String(body.error) : "请求失败");
  return body as T;
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "--";
}

function statusVariant(status: ConnectorStatus) {
  return status === "active" ? "success" as const : "outline" as const;
}

export default function IpaasPage() {
  const { loggedIn, loading } = useLoggedIn();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [newPlatform, setNewPlatform] = useState<IpaasPlatform>("feishu");
  const [newName, setNewName] = useState("");
  const [newAppId, setNewAppId] = useState("");
  const [newAppSecret, setNewAppSecret] = useState("");
  const [newVerificationToken, setNewVerificationToken] = useState("");
  // email fields
  const [newEmailApiUrl, setNewEmailApiUrl] = useState("");
  const [newEmailApiKey, setNewEmailApiKey] = useState("");
  const [newFromEmail, setNewFromEmail] = useState("");
  // webhook fields
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  const [newInbound, setNewInbound] = useState(true);
  const [newOutbound, setNewOutbound] = useState(true);

  const load = async (selectedWorkspaceId?: string) => {
    const ws = await json<{ workspaces: Workspace[] }>("/api/workspaces");
    const selected = selectedWorkspaceId ?? workspaceId ?? ws.workspaces[0]?.id ?? "";
    setWorkspaces(ws.workspaces);
    setWorkspaceId(selected);
    if (selected) {
      const result = await json<{ connectors: Connector[] }>(`/api/ipaas/connectors?workspaceId=${encodeURIComponent(selected)}`);
      setConnectors(result.connectors);
    } else {
      setConnectors([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    load().catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWorkspaceChange = (id: string) => {
    setWorkspaceId(id);
    load(id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "加载失败"));
  };

  const handleCreate = async () => {
    if (!workspaceId || !newName.trim()) return;
    setBusy("create");
    setError(null);
    try {
      const credentials: Record<string, string> = {};
      if (newPlatform === "feishu") {
        if (!newAppId || !newAppSecret) throw new Error("飞书需要 App ID 和 App Secret");
        credentials.appId = newAppId;
        credentials.appSecret = newAppSecret;
        if (newVerificationToken) credentials.verificationToken = newVerificationToken;
      } else if (newPlatform === "email") {
        if (!newEmailApiUrl && !newFromEmail) throw new Error("邮件至少需要 API URL 或发件人地址");
        if (newEmailApiUrl) credentials.apiUrl = newEmailApiUrl;
        if (newEmailApiKey) credentials.apiKey = newEmailApiKey;
        if (newFromEmail) credentials.fromEmail = newFromEmail;
      } else if (newPlatform === "webhook") {
        if (newWebhookSecret) credentials.secret = newWebhookSecret;
        else credentials.secret = "";
      }
      await json("/api/ipaas/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          platform: newPlatform,
          name: newName.trim(),
          credentials,
          inboundEnabled: newInbound,
          outboundEnabled: newOutbound,
        }),
      });
      setShowCreate(false);
      setNewName("");
      setNewAppId("");
      setNewAppSecret("");
      setNewVerificationToken("");
      setNewEmailApiUrl("");
      setNewEmailApiKey("");
      setNewFromEmail("");
      setNewWebhookSecret("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (connectorId: string) => {
    if (!confirm("确定删除此连接器？")) return;
    setBusy(connectorId);
    try {
      await json(`/api/ipaas/connectors/${connectorId}`, { method: "DELETE" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setBusy(null);
    }
  };

  const handleToggleStatus = async (connector: Connector) => {
    setBusy(connector.connectorId);
    try {
      await json(`/api/ipaas/connectors/${connector.connectorId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: connector.status === "active" ? "paused" : "active" }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新失败");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;
  if (!loggedIn) return <LoginGate title="登录后管理 iPaaS 连接器" />;

  return (
    <main className="flex min-h-dvh flex-col bg-bg md:flex-row">
      <WorkbenchRail tasks={[]} activeTaskId={null} onNew={() => { window.location.href = "/fw"; }} onOpen={() => undefined} />
      <div className="mx-auto flex w-[min(100%-2rem,74rem)] flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight">iPaaS 连接器</h1>
            <p className="mt-1 text-sm text-muted-foreground">管理外部平台集成：飞书、邮件、Webhook</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)} disabled={!workspaceId}>
            <Icon name="plus" className="mr-1.5 h-4 w-4" />
            新建连接器
          </Button>
        </header>

        {error && (
          <Card className="border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">关闭</button>
          </Card>
        )}

        <div className="flex items-center gap-4">
          <label className="text-sm font-medium">Workspace</label>
          <ThemeSelect value={workspaceId} onValueChange={handleWorkspaceChange}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="选择 Workspace" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
              ))}
            </SelectContent>
          </ThemeSelect>
        </div>

        {showCreate && (
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold">新建连接器</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">平台</label>
                <ThemeSelect value={newPlatform} onValueChange={(v) => setNewPlatform(v as IpaasPlatform)}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feishu">飞书</SelectItem>
                    <SelectItem value="email">邮件</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </ThemeSelect>
              </div>

              <div>
                <label className="text-sm font-medium">名称</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：产品通知飞书群" className="mt-1 max-w-sm" />
              </div>

              {newPlatform === "feishu" && (
                <>
                  <div>
                    <label className="text-sm font-medium">App ID</label>
                    <Input value={newAppId} onChange={(e) => setNewAppId(e.target.value)} placeholder="cli_xxxxx" className="mt-1 max-w-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">App Secret</label>
                    <Input type="password" value={newAppSecret} onChange={(e) => setNewAppSecret(e.target.value)} placeholder="飞书应用密钥" className="mt-1 max-w-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Verification Token <span className="text-muted-foreground">(可选)</span></label>
                    <Input value={newVerificationToken} onChange={(e) => setNewVerificationToken(e.target.value)} placeholder="事件订阅验证令牌" className="mt-1 max-w-sm" />
                  </div>
                </>
              )}

              {newPlatform === "email" && (
                <>
                  <div>
                    <label className="text-sm font-medium">邮件 API URL</label>
                    <Input value={newEmailApiUrl} onChange={(e) => setNewEmailApiUrl(e.target.value)} placeholder="https://api.sendgrid.com/v3/mail/send" className="mt-1 max-w-sm" />
                    <p className="mt-1 text-xs text-muted-foreground">支持 SendGrid / Mailgun 等 HTTP API，或留空使用 SMTP</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">API Key <span className="text-muted-foreground">(可选)</span></label>
                    <Input type="password" value={newEmailApiKey} onChange={(e) => setNewEmailApiKey(e.target.value)} placeholder="邮件服务 API Key" className="mt-1 max-w-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">发件人地址</label>
                    <Input value={newFromEmail} onChange={(e) => setNewFromEmail(e.target.value)} placeholder="noreply@example.com" className="mt-1 max-w-sm" />
                  </div>
                </>
              )}

              {newPlatform === "webhook" && (
                <div>
                  <label className="text-sm font-medium">签名密钥 <span className="text-muted-foreground">(可选)</span></label>
                  <Input type="password" value={newWebhookSecret} onChange={(e) => setNewWebhookSecret(e.target.value)} placeholder="用于验证入站 Webhook 签名" className="mt-1 max-w-sm" />
                  <p className="mt-1 text-xs text-muted-foreground">留空则不验证签名。出站请求也会用此密钥签名。</p>
                </div>
              )}

              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newInbound} onChange={(e) => setNewInbound(e.target.checked)} className="rounded" />
                  启用入站（接收事件）
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newOutbound} onChange={(e) => setNewOutbound(e.target.checked)} className="rounded" />
                  启用出站（发送消息）
                </label>
              </div>

              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleCreate} disabled={busy === "create"}>
                  {busy === "create" ? "创建中..." : "创建"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>取消</Button>
              </div>
            </div>
          </Card>
        )}

        {connectors.length === 0 ? (
          <EmptyState title="暂无连接器" description="点击上方按钮创建第一个连接器" />
        ) : (
          <div className="space-y-3">
            {connectors.map((connector) => (
              <Card key={connector.connectorId} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Icon name={platformIcons[connector.platform]} className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{connector.name}</span>
                        <Badge variant={statusVariant(connector.status)}>
                          {connector.status === "active" ? "运行中" : "已暂停"}
                        </Badge>
                        <Badge variant="outline">{platformLabels[connector.platform]}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span>ID: {connector.connectorId}</span>
                        <span>入站: {connector.inboundEnabled ? "开" : "关"}</span>
                        <span>出站: {connector.outboundEnabled ? "开" : "关"}</span>
                        <span>最后活动: {time(connector.lastActivityAt)}</span>
                      </div>
                      {connector.lastError && (
                        <div className="mt-1 text-xs text-destructive">错误: {connector.lastError}</div>
                      )}
                      {connector.inboundEnabled && (connector.platform === "feishu" || connector.platform === "webhook") && (
                        <div className="mt-2">
                          <span className="text-xs text-muted-foreground">入站 URL: </span>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {typeof window !== "undefined" ? window.location.origin : ""}{connector.platform === "feishu" ? `/api/ipaas/feishu/inbound/${connector.connectorId}` : `/api/ipaas/webhook/inbound/${connector.connectorId}`}
                          </code>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <IconButton size="sm" onClick={() => handleToggleStatus(connector)} disabled={busy === connector.connectorId} title={connector.status === "active" ? "暂停" : "启用"}>
                      <Icon name={connector.status === "active" ? "pause" : "play"} className="h-4 w-4" />
                    </IconButton>
                    <IconButton size="sm" onClick={() => handleDelete(connector.connectorId)} disabled={busy === connector.connectorId} title="删除">
                      <Icon name="trash-2" className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
