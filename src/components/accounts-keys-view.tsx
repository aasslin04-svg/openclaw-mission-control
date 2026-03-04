"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
  Eye,
  EyeOff,
  FileWarning,
  KeyRound,
  RefreshCw,
  RotateCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Wrench,
} from "lucide-react";
import { InlineSpinner } from "@/components/ui/loading-state";
import { useTranslation } from "@/lib/i18n";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { getTimeFormatSnapshot, withTimeFormat } from "@/lib/time-format-preference";

type AccountsResponse = {
  generatedAt: number;
  configPath: string;
  configHash: string | null;
  sourceOfTruth: {
    gatewayConfig: boolean;
    channelsStatus: boolean;
    modelsStatus: boolean;
  };
  summary: {
    agents: number;
    modelProvidersConnected: number;
    modelProvidersTotal: number;
    authProfiles: number;
    channelAccounts: number;
    channelAccountsRunning: number;
    configEnvKeys: number;
    processEnvKeys: number;
    configSecrets: number;
    discoveredCredentials: number;
    discoveredCredentialServices: number;
  };
  agents: Array<{
    id: string;
    name: string;
    workspace: string | null;
    agentDir: string;
    model: string | null;
    isDefault: boolean;
  }>;
  modelAuthByAgent: Array<{
    agentId: string;
    storePath: string | null;
    shellEnvFallback: { enabled: boolean; appliedKeys: string[] };
    providers: Array<{
      provider: string;
      connected: boolean;
      effectiveKind: string | null;
      effectiveDetail: string | null;
      profileCount: number;
      oauthCount: number;
      tokenCount: number;
      apiKeyCount: number;
      labels: string[];
      envSource: string | null;
      envValue: string | null;
      modelsJsonSource: string | null;
    }>;
    oauthProfiles: Array<{
      profileId: string;
      provider: string;
      type: string;
      status: string;
      source: string;
      label: string;
      expiresAt: number | null;
      remainingMs: number | null;
    }>;
    unusableProfiles: Array<{
      profileId: string;
      provider: string;
      kind: string;
      until: number | null;
      remainingMs: number | null;
    }>;
  }>;
  channels: {
    chat: Record<string, string[]>;
    auth: Array<{ id: string; provider: string; type: string; isExternal: boolean }>;
    accounts: Array<{
      channel: string;
      accountId: string;
      enabled: boolean;
      configured: boolean;
      running: boolean;
      tokenSource: string | null;
      mode: string | null;
      lastError: string | null;
      probeOk: boolean | null;
      botId: string | null;
      botUsername: string | null;
      lastInboundAt: number | null;
      lastOutboundAt: number | null;
      lastProbeAt: number | null;
    }>;
  };
  envCredentials: {
    config: Array<{ key: string; value: string; source: string; redacted: boolean }>;
    process: Array<{ key: string; value: string; source: string; redacted: boolean }>;
  };
  skillCredentials: {
    skills: Array<{
      name: string;
      source: string;
      eligible: boolean;
      disabled: boolean;
      blockedByAllowlist: boolean;
      primaryEnv: string | null;
      requiredEnv: string[];
      missingEnv: string[];
      ready: boolean;
      env: Array<{
        key: string;
        present: boolean;
        source: string | null;
        value: string | null;
        redacted: boolean;
      }>;
    }>;
  };
  discoveredCredentials: {
    summary: {
      total: number;
      services: number;
      highConfidence: number;
    };
    entries: Array<{
      sourcePath: string;
      section: string | null;
      service: string | null;
      key: string;
      value: string;
      redacted: boolean;
      confidence: "high" | "medium";
    }>;
  };
  configSecrets: Array<{
    path: string;
    key: string;
    value: string;
    source: string;
    redacted: boolean;
  }>;
  warnings: string[];
};

type EnvEditorState = {
  editing: boolean;
  show: boolean;
  nextValue: string;
  confirmValue: string;
};

function formatAgo(ts: number | null, t: (key: string) => string): string {
  if (!ts) return t("n/a");
  const ms = Date.now() - ts;
  if (ms < 60_000) return t("{{n}}s ago").replace("{{n}}", String(Math.max(1, Math.floor(ms / 1000))));
  if (ms < 3_600_000) return t("{{n}}m ago").replace("{{n}}", String(Math.floor(ms / 60_000)));
  if (ms < 86_400_000) return t("{{n}}h ago").replace("{{n}}", String(Math.floor(ms / 3_600_000)));
  return t("{{n}}d ago").replace("{{n}}", String(Math.floor(ms / 86_400_000)));
}

function masked(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function renderSecret(value: string, reveal: boolean, alreadyRedacted: boolean): string {
  if (alreadyRedacted) return value;
  return reveal ? value : masked(value);
}

function statusPill(ok: boolean, label: string) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"
          : "inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"
      }
    >
      {ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldX className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

/* ================================================================
   Secrets Management Panel
   ================================================================ */

type AuditFinding = {
  code: string;
  severity: "warn" | "info" | "error";
  file: string;
  path: string;
  message: string;
  provider?: string;
  detail?: string;
};

type AuditData = {
  version: number;
  status: string;
  filesScanned: string[];
  summary: {
    plaintextCount: number;
    unresolvedRefCount: number;
    shadowedRefCount: number;
    legacyResidueCount: number;
  };
  findings: AuditFinding[];
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  warn: {
    bg: "bg-amber-500/10",
    text: "text-amber-300",
    border: "border-amber-500/20",
    icon: <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />,
  },
  error: {
    bg: "bg-red-500/10",
    text: "text-red-300",
    border: "border-red-500/20",
    icon: <FileWarning className="h-3.5 w-3.5 text-red-400" />,
  },
  info: {
    bg: "bg-blue-500/10",
    text: "text-blue-300",
    border: "border-blue-500/20",
    icon: <Shield className="h-3.5 w-3.5 text-blue-400" />,
  },
};

const CODE_LABELS: Record<string, { label: string; hint: string }> = {
  PLAINTEXT_FOUND: {
    label: "Plaintext Secret",
    hint: "This value is stored as plain text. Migrate to a SecretRef (env/file/exec) for better security.",
  },
  UNRESOLVED_REF: {
    label: "Unresolved Reference",
    hint: "A SecretRef points to a source that cannot be resolved. Check the provider or env variable.",
  },
  SHADOWED_REF: {
    label: "Shadowed Reference",
    hint: "This SecretRef is overridden by another source, which may cause unexpected behavior.",
  },
  LEGACY_RESIDUE: {
    label: "Legacy Residue",
    hint: "Old credential format from a previous version. Can be safely cleaned up.",
  },
};

function shortFilePath(path: string): string {
  const home = path.indexOf(".openclaw/");
  if (home >= 0) return path.slice(home);
  const parts = path.split("/");
  return parts.slice(-2).join("/");
}

function SecretsPanel() {
  const { t } = useTranslation(); // SecretsPanel
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [findingsExpanded, setFindingsExpanded] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [configResult, setConfigResult] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadResult, setReloadResult] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/secrets", { cache: "no-store" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAudit(data as AuditData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runAudit();
  }, [runAudit]);

  const handleConfigure = useCallback(async (opts: { apply?: boolean; providersOnly?: boolean; skipProviderSetup?: boolean } = {}) => {
    setConfiguring(true);
    setConfigResult(null);
    setError(null);
    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "configure", ...opts }),
      });
      const data = await res.json();
      if (data.error && !data.ok) throw new Error(data.error);
      setConfigResult(data.ok ? "Configuration applied successfully." : data.raw || data.stderr || "Done.");
      // Re-run audit to refresh findings
      await runAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfiguring(false);
    }
  }, [runAudit]);

  const handleReload = useCallback(async () => {
    setReloading(true);
    setReloadResult(null);
    setError(null);
    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reload" }),
      });
      const data = await res.json();
      if (data.error && !data.ok) throw new Error(data.error);
      setReloadResult("Secrets reloaded successfully. Runtime snapshot updated.");
      await runAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  }, [runAudit]);

  const totalFindings = audit?.findings.length ?? 0;
  const warnCount = audit?.findings.filter((f) => f.severity === "warn").length ?? 0;
  const errorCount = audit?.findings.filter((f) => f.severity === "error").length ?? 0;
  const infoCount = audit?.findings.filter((f) => f.severity === "info").length ?? 0;
  const isClean = totalFindings === 0 && audit?.status === "clean";

  return (
    <div className="rounded-xl border border-border/70 bg-card">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
          <Shield className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-foreground">{t("Secrets Management")}</h2>
            {audit && !loading && (
              isClean ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                  <CheckCircle className="h-2.5 w-2.5" /> {t("Clean")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                  <ShieldAlert className="h-2.5 w-2.5" /> {totalFindings} {totalFindings !== 1 ? t("findings") : t("finding")}
                </span>
              )
            )}
            {loading && <InlineSpinner size="sm" className="text-muted-foreground/50" />}
          </div>
          <p className="text-xs text-muted-foreground/60">
            {t("Audit, configure SecretRefs, and reload runtime secrets")}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground/40 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground/40 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-foreground/10 px-4 py-4 space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Config/Reload success */}
          {configResult && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              {configResult}
            </div>
          )}
          {reloadResult && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              {reloadResult}
            </div>
          )}

          {/* Summary cards */}
          {audit && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
                <p className="text-xs text-muted-foreground/60">{t("Plaintext")}</p>
                <p className={`text-sm font-bold ${audit.summary.plaintextCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                  {audit.summary.plaintextCount}
                </p>
              </div>
              <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
                <p className="text-xs text-muted-foreground/60">{t("Unresolved")}</p>
                <p className={`text-sm font-bold ${audit.summary.unresolvedRefCount > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {audit.summary.unresolvedRefCount}
                </p>
              </div>
              <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
                <p className="text-xs text-muted-foreground/60">{t("Shadowed")}</p>
                <p className={`text-sm font-bold ${audit.summary.shadowedRefCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                  {audit.summary.shadowedRefCount}
                </p>
              </div>
              <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
                <p className="text-xs text-muted-foreground/60">{t("Legacy")}</p>
                <p className={`text-sm font-bold ${audit.summary.legacyResidueCount > 0 ? "text-blue-400" : "text-emerald-400"}`}>
                  {audit.summary.legacyResidueCount}
                </p>
              </div>
            </div>
          )}

          {/* Findings list */}
          {audit && totalFindings > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setFindingsExpanded(!findingsExpanded)}
                className="flex w-full items-center gap-2 text-left text-xs font-medium text-foreground/70 hover:text-foreground/90"
              >
                {findingsExpanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {totalFindings} {totalFindings !== 1 ? t("findings") : t("finding")}
                {warnCount > 0 && <span className="text-amber-400">{warnCount} {t("warn")}</span>}
                {errorCount > 0 && <span className="text-red-400">{errorCount} {t("error")}</span>}
                {infoCount > 0 && <span className="text-blue-400">{infoCount} {t("info")}</span>}
              </button>

              {findingsExpanded && (
                <div className="mt-2 space-y-2">
                  {audit.findings.map((finding, idx) => {
                    const style = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info;
                    const codeMeta = CODE_LABELS[finding.code];
                    return (
                      <div
                        key={`${finding.file}:${finding.path}:${idx}`}
                        className={`rounded-lg border ${style.border} ${style.bg} px-3 py-2.5`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">{style.icon}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-xs font-semibold ${style.text}`}>
                                {codeMeta?.label || finding.code}
                              </span>
                              <code className="rounded bg-foreground/5 px-1.5 py-0.5 text-xs text-muted-foreground">
                                {finding.code}
                              </code>
                            </div>
                            <p className="mt-1 text-xs text-foreground/70">{finding.message}</p>
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground/60">
                              <span>
                                {t("File:")} <code>{shortFilePath(finding.file)}</code>
                              </span>
                              <span>
                                {t("Path:")} <code>{finding.path}</code>
                              </span>
                              {finding.provider && (
                                <span>
                                  {t("Provider:")} <code>{finding.provider}</code>
                                </span>
                              )}
                            </div>
                            {codeMeta?.hint && (
                              <p className="mt-1.5 text-xs text-muted-foreground/50 italic">
                                {codeMeta.hint}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Files scanned */}
          {audit && (
            <p className="text-xs text-muted-foreground/40">
              {audit.filesScanned.length} {audit.filesScanned.length !== 1 ? t("files scanned") : t("file scanned")}
              {audit.status === "clean" && t(" — no issues found")}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 border-t border-foreground/5 pt-3">
            <button
              type="button"
              onClick={() => void runAudit()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/10 disabled:opacity-40"
            >
              {loading ? <InlineSpinner size="sm" /> : <RefreshCw className="h-3 w-3" />}
              {t("Re-audit")}
            </button>
            <button
              type="button"
              onClick={() => void handleConfigure({ apply: true })}
              disabled={configuring || loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              title="Run secrets configure --apply: auto-map plaintext secrets to SecretRefs"
            >
              {configuring ? <InlineSpinner size="sm" /> : <Wrench className="h-3 w-3" />}
              {t("Auto-configure & Apply")}
            </button>
            <button
              type="button"
              onClick={() => void handleConfigure({ providersOnly: true, apply: true })}
              disabled={configuring || loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/10 disabled:opacity-40"
              title="Configure providers only without mapping credentials"
            >
              {configuring ? <InlineSpinner size="sm" /> : <Shield className="h-3 w-3" />}
              {t("Providers Only")}
            </button>
            <button
              type="button"
              onClick={() => void handleReload()}
              disabled={reloading || loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/10 disabled:opacity-40"
              title="Re-resolve secret references and swap runtime snapshot"
            >
              {reloading ? <InlineSpinner size="sm" /> : <RotateCw className="h-3 w-3" />}
              {t("Reload Runtime")}
            </button>
          </div>

          {/* Help text */}
          <div className="rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-2.5">
            <p className="text-xs text-muted-foreground/50 leading-relaxed">
              <strong className="text-foreground/60">Secrets audit</strong> scans your config for plaintext tokens, unresolved SecretRefs, and legacy credentials.{" "}
              <strong className="text-foreground/60">Auto-configure</strong> maps plaintext values to secure SecretRef providers (env/file/exec).{" "}
              <strong className="text-foreground/60">Reload</strong> re-resolves all references and updates the runtime snapshot without restarting.{" "}
              CLI equivalents: <code className="text-muted-foreground/60">openclaw secrets audit</code>, <code className="text-muted-foreground/60">secrets configure --apply</code>, <code className="text-muted-foreground/60">secrets reload</code>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function AccountsKeysView() {
  const { t } = useTranslation(); // AccountsKeysView
  const timeFormat = getTimeFormatSnapshot();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingEnvKey, setSavingEnvKey] = useState<string | null>(null);
  const [envEditors, setEnvEditors] = useState<Record<string, EnvEditorState>>({});
  const [data, setData] = useState<AccountsResponse | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      const body = (await res.json()) as AccountsResponse & { error?: string };
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editableConfigEnvRows = useMemo(() => {
    if (!data) return [] as Array<{
      key: string;
      value: string;
      source: string;
      redacted: boolean;
      present: boolean;
    }>;
    const byKey = new Map<
      string,
      {
        key: string;
        value: string;
        source: string;
        redacted: boolean;
        present: boolean;
      }
    >();

    for (const item of data.envCredentials.config) {
      byKey.set(item.key, {
        key: item.key,
        value: item.value,
        source: item.source,
        redacted: item.redacted,
        present: true,
      });
    }

    for (const skill of data.skillCredentials.skills) {
      for (const env of skill.env) {
        if (byKey.has(env.key)) continue;
        byKey.set(env.key, {
          key: env.key,
          value: env.value || "",
          source: env.source || "missing",
          redacted: env.redacted,
          present: env.present,
        });
      }
    }

    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data]);

  const getEnvEditor = useCallback(
    (key: string): EnvEditorState =>
      envEditors[key] || {
        editing: false,
        show: false,
        nextValue: "",
        confirmValue: "",
      },
    [envEditors]
  );

  const patchEnvEditor = useCallback((key: string, patch: Partial<EnvEditorState>) => {
    setEnvEditors((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {
          editing: false,
          show: false,
          nextValue: "",
          confirmValue: "",
        }),
        ...patch,
      } as EnvEditorState,
    }));
  }, []);

  const startEditEnvKey = useCallback((key: string) => {
    patchEnvEditor(key, { editing: true, nextValue: "", confirmValue: "" });
  }, [patchEnvEditor]);

  const cancelEditEnvKey = useCallback((key: string) => {
    patchEnvEditor(key, {
      editing: false,
      show: false,
      nextValue: "",
      confirmValue: "",
    });
  }, [patchEnvEditor]);

  const saveEnvKey = useCallback(
    async (key: string) => {
      const editor = getEnvEditor(key);
      const nextValue = editor.nextValue.trim();
      if (!nextValue) {
        setError(`New value for ${key} cannot be empty.`);
        return;
      }
      if (editor.nextValue !== editor.confirmValue) {
        setError(`Confirmation does not match for ${key}.`);
        return;
      }

      setSavingEnvKey(key);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update-env-key",
            key,
            value: editor.nextValue,
          }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) {
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        cancelEditEnvKey(key);
        setNotice(`Updated ${key}.`);
        await load(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingEnvKey(null);
      }
    },
    [cancelEditEnvKey, getEnvEditor, load]
  );

  return (
    <SectionLayout>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t("Accounts & Keys")}
          </span>
        }
        description={t("Complete visibility into channels, integrations, env keys, and discovered credential sources OpenClaw can access.")}
        meta={
          data
            ? `Last sync: ${new Date(data.generatedAt).toLocaleString(
              undefined,
              withTimeFormat(
                {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                },
                timeFormat,
              ),
            )}`
            : t("Loading source-of-truth snapshot…")
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRevealSecrets((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              disabled={!data}
            >
              {revealSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {revealSecrets ? t("Hide Values") : t("Reveal Values")}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              disabled={busy}
            >
              {busy ? (
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span>
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t("Refresh")}
            </button>
          </div>
        }
      />

      <SectionBody width="narrow" className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {notice}
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-xl border border-border/70 bg-card" />
            <div className="h-48 animate-pulse rounded-xl border border-border/70 bg-card" />
            <div className="h-48 animate-pulse rounded-xl border border-border/70 bg-card" />
          </div>
        ) : null}

        {data ? (
          <>
            <div className="rounded-xl border border-border/70 bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {statusPill(data.sourceOfTruth.gatewayConfig, t("Gateway Config"))}
                {statusPill(data.sourceOfTruth.channelsStatus, t("Channel Runtime"))}
                {statusPill(data.sourceOfTruth.modelsStatus, t("Model Auth Runtime"))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("Agents")}</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.agents}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("Model Providers Connected")}</p>
                  <p className="mt-1 text-xs font-semibold">
                    {data.summary.modelProvidersConnected}/{data.summary.modelProvidersTotal}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("Model Auth Profiles")}</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.authProfiles}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("Channel Accounts Running")}</p>
                  <p className="mt-1 text-xs font-semibold">
                    {data.summary.channelAccountsRunning}/{data.summary.channelAccounts}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("Config Env Credentials")}</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.configEnvKeys}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("Process Env Credentials")}</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.processEnvKeys}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("Discovered External Credentials")}</p>
                  <p className="mt-1 text-xs font-semibold">
                    {data.summary.discoveredCredentials} ({data.summary.discoveredCredentialServices} {t("services")})
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3 sm:col-span-2">
                  <p className="text-xs text-muted-foreground">{t("Discovered Config Secrets")}</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.configSecrets}</p>
                </div>
              </div>
            </div>

            <SecretsPanel />

            <div className="rounded-xl border border-border/70 bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Cpu className="h-4 w-4" />
                  {t("Model Provider Auth")}
                </h2>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {data.summary.modelProvidersConnected} {t("of")} {data.summary.modelProvidersTotal} {t("providers connected")}
                {data.summary.authProfiles > 0 && ` · ${data.summary.authProfiles} ${t("auth profiles")}`}
              </p>
              <a
                href="/models"
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t("Manage in Models →")}
              </a>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-4">
              <h2 className="text-xs font-semibold text-foreground">{t("Channel Accounts")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Logged-in chat accounts, status, and auth source.")}
              </p>
              <div className="mt-3 space-y-2">
                {data.channels.accounts.map((acct) => (
                  <div
                    key={`${acct.channel}:${acct.accountId}`}
                    className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {acct.channel} / {acct.accountId}
                      </p>
                      <p className={acct.running ? "text-emerald-300" : "text-red-300"}>
                        {acct.running ? t("running") : t("stopped")}
                      </p>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      configured={String(acct.configured)} enabled={String(acct.enabled)} tokenSource={acct.tokenSource || "n/a"} mode={acct.mode || "n/a"}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      bot={acct.botUsername || "n/a"} ({acct.botId || "n/a"}) · probe={acct.probeOk == null ? "n/a" : String(acct.probeOk)} · inbound={formatAgo(acct.lastInboundAt, t)} · outbound={formatAgo(acct.lastOutboundAt, t)}
                    </p>
                    {acct.lastError ? (
                      <p className="mt-1 text-red-300">lastError: {acct.lastError}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-4">
              <h2 className="text-xs font-semibold text-foreground">{t("Discovered Credential Sources")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Generic detection from accessible files/notes/state (not provider hardcoded).")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                entries={data.discoveredCredentials.summary.total} · services={data.discoveredCredentials.summary.services} · high-confidence={data.discoveredCredentials.summary.highConfidence}
              </p>
              <div className="mt-3 space-y-2">
                {data.discoveredCredentials.entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("No additional credential entries discovered.")}</p>
                ) : null}
                {data.discoveredCredentials.entries.map((entry, idx) => (
                  <div
                    key={`${entry.sourcePath}:${entry.key}:${entry.service || "unknown"}:${idx}`}
                    className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {entry.service || t("unknown service")} · {entry.key}
                      </p>
                      <span className={entry.confidence === "high" ? "text-emerald-300" : "text-amber-300"}>
                        {entry.confidence}
                      </span>
                    </div>
                    {entry.section ? (
                      <p className="mt-1 text-muted-foreground">
                        {t("section:")} <code>{entry.section}</code>
                      </p>
                    ) : null}
                    <p className="mt-1 break-all text-muted-foreground">
                      {t("source:")} <code>{entry.sourcePath}</code>
                    </p>
                    <p className="mt-1 break-all text-muted-foreground">
                      {t("value:")} <code>{renderSecret(entry.value, revealSecrets, entry.redacted)}</code>
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-card p-4">
                <h2 className="text-xs font-semibold text-foreground">{t("Config Env Credentials")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("Vercel-style edit flow: current value plus double-entry confirmation.")}
                </p>
                <div className="mt-3 space-y-2">
                  {editableConfigEnvRows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("No env credential keys discovered.")}</p>
                  ) : null}
                  {editableConfigEnvRows.map((item) => {
                    const editor = getEnvEditor(item.key);
                    const saving = savingEnvKey === item.key;
                    return (
                      <div
                        key={item.key}
                        className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-foreground">{item.key}</p>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => patchEnvEditor(item.key, { show: !editor.show })}
                              className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                            >
                              {editor.show ? t("Hide") : t("Show")}
                            </button>
                            {!editor.editing ? (
                              <button
                                type="button"
                                onClick={() => startEditEnvKey(item.key)}
                                className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                              >
                                {item.present ? t("Edit") : t("Set")}
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void saveEnvKey(item.key)}
                                  className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                                  disabled={saving}
                                >
                                  {saving ? t("Saving...") : t("Save")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelEditEnvKey(item.key)}
                                  className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                                >
                                  {t("Cancel")}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("source:")} {item.source}
                        </p>
                        <div className="mt-2 space-y-1">
                          <label className="block">
                            <span className="text-xs text-muted-foreground">{t("Current value")}</span>
                            <input
                              type={revealSecrets || editor.show ? "text" : "password"}
                              readOnly
                              value={
                                item.present
                                  ? renderSecret(
                                    item.value,
                                    revealSecrets || editor.show,
                                    item.redacted
                                  )
                                  : ""
                              }
                              placeholder={item.present ? "" : t("Not set")}
                              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground"
                            />
                          </label>
                          {editor.editing && (
                            <>
                              <label className="block">
                                <span className="text-xs text-muted-foreground">{t("New value")}</span>
                                <input
                                  type={editor.show ? "text" : "password"}
                                  value={editor.nextValue}
                                  onChange={(e) =>
                                    patchEnvEditor(item.key, { nextValue: e.target.value })
                                  }
                                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
                                />
                              </label>
                              <label className="block">
                                <span className="text-xs text-muted-foreground">{t("Confirm new value")}</span>
                                <input
                                  type={editor.show ? "text" : "password"}
                                  value={editor.confirmValue}
                                  onChange={(e) =>
                                    patchEnvEditor(item.key, { confirmValue: e.target.value })
                                  }
                                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
                                />
                              </label>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-card p-4">
                <h2 className="text-xs font-semibold text-foreground">{t("Process Env Credentials")}</h2>
                <div className="mt-3 space-y-1">
                  {data.envCredentials.process.map((item) => (
                    <p key={item.key} className="break-all text-xs text-muted-foreground">
                      <span className="text-foreground">{item.key}</span> ={" "}
                      <code>{renderSecret(item.value, revealSecrets, item.redacted)}</code>
                    </p>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-4">
              <h2 className="text-xs font-semibold text-foreground">{t("Config Secrets (Non-env)")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Credential-like fields discovered in parsed config (excluding `env`).")}
              </p>
              <div className="mt-3 max-h-96 space-y-1 overflow-y-auto">
                {data.configSecrets.map((secret) => (
                  <p key={secret.path} className="break-all text-xs text-muted-foreground">
                    <span className="text-foreground">{secret.path}</span> ={" "}
                    <code>{renderSecret(secret.value, revealSecrets, secret.redacted)}</code>
                  </p>
                ))}
              </div>
            </div>

            {data.warnings.length > 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
                <div className="mb-2 inline-flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("Partial data warnings")}
                </div>
                {data.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </SectionBody>
    </SectionLayout>
  );
}
