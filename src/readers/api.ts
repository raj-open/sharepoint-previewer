// Sharepoint REST API (same site, the user's session): JSON reads and writes, only if the setting allows it

// ===========================================================================
// IMPORTS
// ===========================================================================

import { SHAREPOINT_API } from '../_core/settings.ts';
import { sameOrigin } from './request.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const API_OFF = 'not allowed (setting "sharepoint-api")';

const SITE_RE = /^\/(?:sites|teams)\/[^/]+/i; // site of a server-relative path ('' = root site)
const JSON_TYPE = 'application/json;odata=nometadata';
const DIGEST_MARGIN = 60; // s: a form digest is renewed this long before it runs out

// Form digest per site (needed by every POST): value and when it runs out (ms)
const digests: Map<string, { value: string; until: number }> = new Map();

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns features that use the API may run (setting) */
export const apiAllowed = (): boolean => SHAREPOINT_API;

/** @param path server-relative @returns its site, server-relative ('' = root site) */
export const siteOf = (path: string): string => path.match(SITE_RE)?.[0] ?? '';

/** @returns library of the open list view (server-relative, …/Forms/<view>.aspx cut off), or null */
export function libraryOfPage(): string | null {
    const path = decodeURIComponent(location.pathname);
    const i = path.toLowerCase().indexOf('/forms/');
    return i < 0 ? null : path.slice(0, i);
}

/** @returns OData string literal: 'it''s' */
export const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** @returns parsed JSON (of the shape the caller expects), or why not (setting, other origin, HTTP status, failed) */
export async function getJson<T>(url: string): Promise<T | string> {
    return request<T>(url, { method: 'GET' });
}

/** POST with a form digest of the site (fetched first, kept until it runs out) @returns JSON, or why not */
export async function postJson<T>(site: string, url: string, body: unknown): Promise<T | string> {
    const digest = await formDigest(site);
    if (!digest.value) return digest.why;
    return request<T>(url, {
        method: 'POST',
        headers: { 'Content-Type': JSON_TYPE, 'X-RequestDigest': digest.value },
        body: JSON.stringify(body),
    });
}

async function request<T>(url: string, init: RequestInit): Promise<T | string> {
    if (!apiAllowed()) return API_OFF;
    if (!sameOrigin(url)) return 'refused (other origin)';
    try {
        const headers = { Accept: JSON_TYPE, ...(init.headers as Record<string, string>) };
        const res = await fetch(url, { ...init, headers, credentials: 'same-origin' });
        // an empty answer (e.g. deleteObject()): null
        if (res.ok) {
            const text = await res.text();
            return (text ? JSON.parse(text) : null) as T;
        }
        return `HTTP ${res.status}${await errorText(res)}`;
    } catch (e) {
        return `failed (${e instanceof Error ? e.message : e})`;
    }
}

// Sharepoint's own message of a refused request, if any: {"odata.error":{"message":{"value":"…"}}}
async function errorText(res: Response): Promise<string> {
    try {
        const data = await res.json();
        const msg = data?.['odata.error']?.message?.value ?? data?.error?.message?.value ?? data?.error?.message;
        return typeof msg === 'string' && msg ? `: ${msg}` : '';
    } catch {
        return '';
    }
}

/** @returns form digest of a site (POST _api/contextinfo), or why there is none */
async function formDigest(site: string): Promise<{ value: string; why: string }> {
    const kept = digests.get(site);
    if (kept && kept.until > Date.now()) return { value: kept.value, why: '' };
    const data = await request<{ FormDigestValue?: string; FormDigestTimeoutSeconds?: number }>(
        `${site}/_api/contextinfo`,
        { method: 'POST' },
    );
    if (typeof data === 'string') return { value: '', why: `no form digest: ${data}` };
    const value = data?.FormDigestValue ?? '';
    const seconds = Math.max(0, (data?.FormDigestTimeoutSeconds ?? 1800) - DIGEST_MARGIN);
    if (value) digests.set(site, { value, until: Date.now() + seconds * 1000 });
    return { value, why: value ? '' : 'no form digest' };
}
