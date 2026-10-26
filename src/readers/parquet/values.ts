// Parquet values: display text (dates, decimals, strings, ...)

// ===========================================================================
// IMPORTS
// ===========================================================================

import { utf8 } from '../bytes.ts';

// ===========================================================================
// METHODS
// ===========================================================================

/** @param {Uint8Array} b @returns {bigint} */
const bytesToBigInt = (b) => {
    let v = 0n;
    for (const x of b) v = (v << 8n) | BigInt(x);
    return b.length && b[0] & 0x80 ? v - (1n << BigInt(b.length * 8)) : v;
};

/** @param {bigint} v @param {number} scale @returns {string} */
const decimalText = (v, scale) => {
    if (!scale) return v.toString();
    const neg = v < 0n;
    const digits = (neg ? -v : v).toString().padStart(scale + 1, '0');
    return `${neg ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
};

/** @param {Uint8Array} b @returns {string} */
const hexText = (b) =>
    [...b.subarray(0, 32)].map((x) => x.toString(16).padStart(2, '0')).join('') + (b.length > 32 ? '…' : '');

/** @param {number|bigint} v @param {number} unit 1 ms, 2 µs, 3 ns @param {boolean} withDate @returns {string} */
function timeText(v, unit, withDate) {
    const per = { 1: 1n, 2: 1000n, 3: 1000000n }[unit] || 1n;
    const big = BigInt(v);
    const ms = Number(big / per);
    const rest = big % per;
    try {
        let iso = new Date(ms).toISOString();
        if (rest) iso = iso.replace('Z', `${String(rest < 0n ? -rest : rest).padStart(per === 1000n ? 3 : 6, '0')}Z`);
        return withDate ? iso : iso.slice(11, -1);
    } catch {
        return big.toString();
    }
}

/** @param {Object|undefined} u @returns {number} */
const unitOf = (u) => (u ? Number(Object.keys(u)[0]) : 1);

/** @param {Object<string, *>} col @param {*} v @returns {string|null} */
export function valueText(col, v) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return JSON.stringify(v.map((x) => valueText(col, x)));
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
    const lt = col.logical || {};
    const ct = col.converted;
    const scale = lt[5]?.[1] ?? col.scale ?? 0;

    if (v instanceof Uint8Array) {
        if (lt[5] || ct === 5) return decimalText(bytesToBigInt(v), scale);
        if (lt[14] && v.length === 16) {
            const h = hexText(v);
            return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        }
        if (lt[1] || ct === 0 || lt[4] || ct === 4 || lt[12] || ct === 19) return utf8.decode(v);
        const s = utf8.decode(v);
        // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters mark binary values
        return s.includes('�') || /[\x00-\x08]/.test(s) ? `0x${hexText(v)}` : s;
    }
    if (typeof v === 'number' || typeof v === 'bigint') {
        if (lt[5] || ct === 5) return decimalText(BigInt(v), scale);
        if (lt[6] || ct === 6) return new Date(Number(v) * 86400000).toISOString().slice(0, 10);
        if (lt[8]) return timeText(v, unitOf(lt[8][2]), true);
        if (ct === 9 || ct === 10) return timeText(v, ct === 9 ? 1 : 2, true);
        if (lt[7]) return timeText(v, unitOf(lt[7][2]), false);
        if (ct === 7 || ct === 8) return timeText(v, ct === 7 ? 1 : 2, false);
        if ((lt[10] && lt[10][2] === false) || (ct >= 11 && ct <= 14)) {
            return typeof v === 'bigint' ? BigInt.asUintN(64, v).toString() : String(v >>> 0);
        }
    }
    return String(v);
}
