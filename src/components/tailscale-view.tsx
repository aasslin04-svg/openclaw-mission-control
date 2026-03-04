"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Waypoints,
  RefreshCw,
  CheckCircle2,
  CircleX,
  ShieldAlert,
  AlertTriangle,
} from "lucide-react";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { requestRestart } from "@/lib/restart-store";
import { useTranslation } from "@/lib/i18n";

type GatewaySnapshot = {
  status?: string;
};

type TailscaleRuntime = {
  ok?: boolean;
  installed?: boolean;
  version?: string | null;
  connected?: boolean;
  backendState?: string | null;
  dnsName?: string | null;
  tailscaleIps?: string[];
  health?: string[];
  serveConfigured?: boolean;
  funnelPublic?: boolean;
  tailnetOnly?: boolean;
  urls?: string[];
  hasServeWebHandlers?: boolean;
  hasServeTcpHandlers?: boolean;
  error?: string;
};

type SaveOptions = {
  restartNow?: boolean;
  nextMode?: "off" | "serve" | "funnel";
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseArgs(input: string): string[] {
  return input
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

export function TailscaleView() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cliOutput, setCliOutput] = useState<string>("");
  const [advancedCommand, setAdvancedCommand] = useState("status --json");

  const [baseHash, setBaseHash] = useState("");
  const [gatewayStatus, setGatewayStatus] = useState<GatewaySnapshot | null>(null);
  const [runtime, setRuntime] = useState<TailscaleRuntime | null>(null);

  const [mode, setMode] = useState<"off" | "serve" | "funnel">("off");
  const [loadedMode, setLoadedMode] = useState<"off" | "serve" | "funnel">("off");
  const [resetOnExit, setResetOnExit] = useState(false);
  const [loadedResetOnExit, setLoadedResetOnExit] = useState(false);
  const [allowTailscaleAuth, setAllowTailscaleAuth] = useState(true);
  const [loadedAllowTailscaleAuth, setLoadedAllowTailscaleAuth] = useState(true);
  const [authMode, setAuthMode] = useState<string>("token");

  const hasUnsaved =
    mode !== loadedMode ||
    resetOnExit !== loadedResetOnExit ||
    allowTailscaleAuth !== loadedAllowTailscaleAuth;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configRes, gatewayRes, tailscaleRes] = await Promise.all([
        fetch("/api/config", { cache: "no-store" }),
        fetch("/api/gateway", { cache: "no-store" }).catch(() => null),
        fetch("/api/tailscale", { cache: "no-store" }).catch(() => null),
      ]);

      if (!configRes.ok) {
        const data = await configRes.json().catch(() => ({}));
        throw new Error(String(data?.error || `HTTP ${configRes.status}`));
      }

      const data = await configRes.json();
      const rawConfig = asRecord(data?.rawConfig);
      const gateway = asRecord(rawConfig.gateway);
      const tailscale = asRecord(gateway.tailscale);
      const auth = asRecord(gateway.auth);

      const rawMode = String(tailscale.mode || "off").toLowerCase();
      const parsedMode = rawMode === "serve" || rawMode === "funnel" ? rawMode : "off";

      const parsedReset = Boolean(tailscale.resetOnExit);
      const parsedAllowTailscale = auth.allowTailscale !== false;

      setMode(parsedMode);
      setLoadedMode(parsedMode);
      setResetOnExit(parsedReset);
      setLoadedResetOnExit(parsedReset);
      setAllowTailscaleAuth(parsedAllowTailscale);
      setLoadedAllowTailscaleAuth(parsedAllowTailscale);
      setAuthMode(String(auth.mode || "token"));
      setBaseHash(String(data?.baseHash || ""));

      if (gatewayRes?.ok) {
        setGatewayStatus((await gatewayRes.json()) as GatewaySnapshot);
      } else {
        setGatewayStatus(null);
      }

      if (tailscaleRes?.ok) {
        setRuntime((await tailscaleRes.json()) as TailscaleRuntime);
      } else {
        setRuntime(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restartGateway = useCallback(async () => {
    const res = await fetch("/api/gateway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restart" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(String(data?.error || data?.message || `HTTP ${res.status}`));
    }
  }, []);

  const save = useCallback(
    async (options?: SaveOptions) => {
      const nextMode = options?.nextMode ?? mode;
      const restartNow = options?.restartNow ?? false;

      setSaving(true);
      setError(null);
      setNotice(null);

      try {
        const res = await fetch("/api/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patch: {
              gateway: {
                tailscale: {
                  mode: nextMode,
                  resetOnExit,
                },
                auth: {
                  allowTailscale: allowTailscaleAuth,
                },
              },
            },
            baseHash,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String(data?.error || `HTTP ${res.status}`));
        }

        if (restartNow) {
          await restartGateway();
          setNotice(t("Tailscale configuration saved ({{mode}}) and gateway restart requested.").replace("{{mode}}", nextMode));
        } else {
          setNotice(t("Tailscale configuration saved ({{mode}}).").replace("{{mode}}", nextMode));
          requestRestart(t("Tailscale configuration was updated."));
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [allowTailscaleAuth, baseHash, load, mode, resetOnExit, restartGateway]
  );

  const quickToggle = useCallback(async () => {
    const nextMode: "off" | "serve" = loadedMode === "off" ? "serve" : "off";
    await save({ restartNow: true, nextMode });
  }, [loadedMode, save]);

  const runRuntimeAction = useCallback(
    async (action: string, summary: string, args?: string[]) => {
      setRuntimeBusy(action);
      setError(null);
      setNotice(null);

      try {
        const res = await fetch("/api/tailscale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args ? { action, args } : { action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) {
          throw new Error(String(data?.error || data?.message || `HTTP ${res.status}`));
        }

        setCliOutput(String(data?.output || ""));
        setNotice(summary);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRuntimeBusy(null);
      }
    },
    [load]
  );

  const runAdvanced = useCallback(async () => {
    const args = parseArgs(advancedCommand);
    if (args.length === 0) {
      setError(t("Enter tailscale arguments, e.g. status --json"));
      return;
    }
    await runRuntimeAction("run", t("Ran tailscale {{args}}").replace("{{args}}", args.join(" ")), args);
  }, [advancedCommand, runRuntimeAction]);

  const tunnelActive = useMemo(() => {
    if (!runtime?.installed) return false;
    if (loadedMode === "off") return false;
    if (!runtime.connected) return false;
    if (loadedMode === "serve") return Boolean(runtime.serveConfigured);
    if (loadedMode === "funnel") return Boolean(runtime.serveConfigured) && Boolean(runtime.funnelPublic);
    return false;
  }, [loadedMode, runtime]);

  const modeBadge = useMemo(() => {
    if (!initialized && loading) {
      return <span className="h-6 w-24 animate-pulse rounded-full bg-muted" />;
    }
    if (loadedMode !== "off") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" /> {t("Exposure")} {loadedMode}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-1 text-xs text-zinc-300">
        <CircleX className="h-3.5 w-3.5" /> {t("Exposure off")}
      </span>
    );
  }, [initialized, loadedMode, loading]);

  const tunnelBadge = useMemo(() => {
    if (!initialized && loading) {
      return <span className="h-6 w-24 animate-pulse rounded-full bg-muted" />;
    }
    if (!runtime?.installed) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" /> {t("Tailscale CLI missing")}
        </span>
      );
    }
    if (loadedMode === "off") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-1 text-xs text-zinc-300">
          <CircleX className="h-3.5 w-3.5" /> {t("Tunnel disabled")}
        </span>
      );
    }
    if (tunnelActive) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" /> {t("Tunnel active")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" /> {t("Tunnel not active")}
      </span>
    );
  }, [initialized, loadedMode, loading, runtime, tunnelActive]);

  const quickToggleLabel = loadedMode === "off" ? t("Turn On (serve)") : t("Turn Off");
  const canRunRuntimeActions = Boolean(runtime?.installed) && !saving && !loading && !runtimeBusy;

  return (
    <SectionLayout>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Waypoints className="h-5 w-5" />
            {t("Tailscale")}
          </span>
        }
        description={t("Manage gateway Tailscale exposure and run Tailscale CLI actions from the UI.")}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void quickToggle()}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
              disabled={loading || saving || runtimeBusy !== null || !baseHash}
            >
              {quickToggleLabel}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              disabled={loading || saving}
            >
              {loading ? (
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
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Live status</p>
            <div className="flex flex-wrap items-center gap-2">
              {modeBadge}
              {tunnelBadge}
            </div>
          </div>

          {!initialized && loading ? (
            <div className="space-y-2">
              <div className="h-4 w-56 animate-pulse rounded bg-muted" />
              <div className="h-4 w-64 animate-pulse rounded bg-muted" />
              <div className="h-4 w-52 animate-pulse rounded bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{t("Configured exposure mode:")} <code>{loadedMode}</code></p>
              <p>{t("Tunnel state:")} <code>{tunnelActive ? t("active") : t("inactive")}</code></p>
              <p>{t("Gateway:")} <code>{gatewayStatus?.status || t("unknown")}</code></p>
              <p>{t("Auth mode:")} <code>{authMode}</code></p>
              <p>{t("Tailscale daemon:")} <code>{runtime?.backendState || t("unknown")}</code></p>
              <p>{t("Connected to tailnet:")} <code>{runtime?.connected ? t("yes") : t("no")}</code></p>
              <p>{t("Serve routes configured:")} <code>{runtime?.serveConfigured ? t("yes") : t("no")}</code></p>
              <p>{t("Funnel public:")} <code>{runtime?.funnelPublic ? t("yes") : t("no")}</code></p>
              {runtime?.version && <p>{t("CLI version:")} <code>{runtime.version}</code></p>}
              {runtime?.dnsName && (
                <p>{t("Tailnet DNS:")} <code>{runtime.dnsName}</code></p>
              )}
              {runtime?.tailscaleIps && runtime.tailscaleIps.length > 0 && (
                <p>{t("Tailscale IPs:")} <code>{runtime.tailscaleIps.join(", ")}</code></p>
              )}
            </div>
          )}

          {runtime?.urls && runtime.urls.length > 0 && (
            <div className="mt-3 rounded-md border border-border bg-background/60 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">{t("Exposed URL")}{runtime.urls.length > 1 ? "s" : ""}</p>
              {runtime.urls.map((url) => (
                <p key={url}>
                  <a className="text-violet-300 hover:text-violet-200" href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </p>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-md border border-border bg-background/60 p-3">
            <p className="mb-2 text-xs font-medium text-foreground">{t("Runtime controls")}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runRuntimeAction("up", "Connected tailscale daemon (tailscale up).")}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!canRunRuntimeActions}
              >
                Connect
              </button>
              <button
                type="button"
                onClick={() => void runRuntimeAction("down", "Disconnected tailscale daemon (tailscale down).")}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!canRunRuntimeActions}
              >
                Disconnect
              </button>
              <button
                type="button"
                onClick={() => void runRuntimeAction("serve-reset", "Cleared serve configuration (tailscale serve reset).")}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!canRunRuntimeActions}
              >
                Reset Serve
              </button>
              <button
                type="button"
                onClick={() => void runRuntimeAction("funnel-reset", "Cleared funnel configuration (tailscale funnel reset).")}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!canRunRuntimeActions}
              >
                Reset Funnel
              </button>
              <button
                type="button"
                onClick={() => void runRuntimeAction("serve-status", "Loaded serve status (tailscale serve status).")}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!canRunRuntimeActions}
              >
                Serve Status
              </button>
              <button
                type="button"
                onClick={() => void runRuntimeAction("funnel-status", "Loaded funnel status (tailscale funnel status).")}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!canRunRuntimeActions}
              >
                Funnel Status
              </button>
              <button
                type="button"
                onClick={() => void runRuntimeAction("netcheck", "Ran tailscale netcheck.")}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={!canRunRuntimeActions}
              >
                Netcheck
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">{t("Advanced command (`tailscale <args...>`)")}</p>
              <div className="flex items-center gap-2">
                <input
                  value={advancedCommand}
                  onChange={(e) => setAdvancedCommand(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
                  placeholder="status --json"
                  disabled={!runtime?.installed || saving || loading || runtimeBusy !== null}
                />
                <button
                  type="button"
                  onClick={() => void runAdvanced()}
                  className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs font-medium hover:bg-primary/90 disabled:opacity-60"
                  disabled={!runtime?.installed || saving || loading || runtimeBusy !== null}
                >
                  {t("Run")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t("Examples:")} <code>status --json</code>, <code>ip -4</code>, <code>ping host.tailnet.ts.net</code></p>
              {cliOutput && (
                <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-2 text-xs text-muted-foreground">
                  {cliOutput}
                </pre>
              )}
            </div>
          </div>

          {mode !== loadedMode && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              {t("Draft exposure mode is {{mode}} (not saved yet).").replace("{{mode}}", mode)}
            </div>
          )}

          {runtime?.error && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              {t("Runtime status error:")} {runtime.error}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4">
          <p className="mb-3 text-sm font-medium text-foreground">{t("Configuration")}</p>

          {!initialized && loading ? (
            <div className="space-y-3">
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
              <div className="h-5 w-64 animate-pulse rounded bg-muted" />
              <div className="h-5 w-72 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{t("Exposure mode")}</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "off" | "serve" | "funnel")}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  disabled={loading || saving}
                >
                  <option value="off">off</option>
                  <option value="serve">serve</option>
                  <option value="funnel">funnel</option>
                </select>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={resetOnExit}
                  onChange={(e) => setResetOnExit(e.target.checked)}
                  disabled={loading || saving}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-foreground">{t("Reset Tailscale on gateway exit")}</span>
                  <span className="block text-xs text-muted-foreground">{t("Clears serve/funnel state during shutdown.")}</span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowTailscaleAuth}
                  onChange={(e) => setAllowTailscaleAuth(e.target.checked)}
                  disabled={loading || saving}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-foreground">{t("Allow unauthenticated tailnet access")}</span>
                  <span className="block text-xs text-muted-foreground">{t("Maps to `gateway.auth.allowTailscale`.")}</span>
                </span>
              </label>
            </div>
          )}

          {mode === "funnel" && authMode !== "password" && (
            <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <div className="mb-1 inline-flex items-center gap-1 font-medium">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t("Funnel mode requires password auth.")}
              </div>
              <p>{t("Set `gateway.auth.mode` to `password` in Config before enabling funnel mode.")}</p>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {notice && (
            <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              {notice}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              disabled={loading || saving}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
              disabled={loading || saving || !baseHash || !hasUnsaved}
            >
              {saving ? t("Saving...") : t("Save")}
            </button>
            <button
              type="button"
              onClick={() => void save({ restartNow: true })}
              className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-60"
              disabled={loading || saving || !baseHash || !hasUnsaved}
            >
              {t("Save + Restart")}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t("Config paths")}</p>
          <p><code>gateway.tailscale.mode</code></p>
          <p><code>gateway.tailscale.resetOnExit</code></p>
          <p><code>gateway.auth.allowTailscale</code></p>
        </div>
      </SectionBody>
    </SectionLayout>
  );
}
