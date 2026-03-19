/**
 * Short-lived in-memory caches for expensive operations.
 *
 * The frontend polls /api/usage and /api/usage/alerts every 15s.
 * Both call fetchGatewaySessions() (~4.5s) and /api/usage also calls
 * runCliJson("models status") (~4.2s). These caches eliminate
 * redundant calls within the same polling cycle.
 *
 * Each cache includes in-flight request deduplication to prevent
 * duplicate concurrent fetches.
 *
 * IMPORTANT: Caches only store non-empty successful results to avoid
 * caching transient gateway failures.
 */

import { fetchGatewaySessions } from "@/lib/gateway-sessions";
import type { NormalizedGatewaySession } from "@/lib/gateway-sessions";
import { runCliJson } from "@/lib/openclaw";

/* ── Gateway Sessions Cache ────────────────────── */

const SESSION_TTL = 10_000; // 10 seconds (poll interval is 15s)

let sessionCache: {
    data: NormalizedGatewaySession[];
    expiresAt: number;
} | null = null;

let sessionInflight: Promise<NormalizedGatewaySession[]> | null = null;

export async function getCachedGatewaySessions(
    timeout = 12000,
): Promise<NormalizedGatewaySession[]> {
    if (sessionCache && Date.now() < sessionCache.expiresAt) {
        return sessionCache.data;
    }
    if (sessionInflight) return sessionInflight;

    sessionInflight = fetchGatewaySessions(timeout)
        .then((data) => {
            // Only cache non-empty results to avoid caching gateway failures
            if (data.length > 0) {
                sessionCache = { data, expiresAt: Date.now() + SESSION_TTL };
            }
            sessionInflight = null;
            return data;
        })
        .catch((err) => {
            sessionInflight = null;
            // If we have stale cached data and the fetch failed, return stale data
            // instead of throwing — better to show slightly old data than nothing
            if (sessionCache) {
                return sessionCache.data;
            }
            throw err;
        });

    return sessionInflight;
}

/* ── Model Status Cache ────────────────────────── */

const MODEL_STATUS_TTL = 30_000; // 30 seconds (model config rarely changes)

let modelStatusCache: {
    data: unknown;
    expiresAt: number;
} | null = null;

let modelStatusInflight: Promise<unknown> | null = null;

export async function getCachedModelStatus<T>(
    timeout = 10000,
): Promise<T> {
    if (modelStatusCache && Date.now() < modelStatusCache.expiresAt) {
        return modelStatusCache.data as T;
    }
    if (modelStatusInflight) return modelStatusInflight as Promise<T>;

    modelStatusInflight = runCliJson<T>(["models", "status"], timeout)
        .then((data) => {
            modelStatusCache = { data, expiresAt: Date.now() + MODEL_STATUS_TTL };
            modelStatusInflight = null;
            return data;
        })
        .catch((err) => {
            modelStatusInflight = null;
            // Return stale cache on failure if available
            if (modelStatusCache) {
                return modelStatusCache.data as T;
            }
            throw err;
        });

    return modelStatusInflight as Promise<T>;
}
