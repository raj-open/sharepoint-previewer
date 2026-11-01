// Solibri rulesets: hints on rules, read from their values alone (not Solibri's definitions: rules of thumb, cf. /TECHNICAL.md):
// - error: values that contradict each other (minimum above maximum, components included and excluded,
//   rules that cannot both hold)
// - warning: likely a mistake (name and values disagree, the same rule twice, check mode and switch at odds)
// - info: worth knowing (values the check mode probably ignores, rules switched off, empty filters, no explanation)
// Distances: a pair of parameters `… Min` / `… Max`; which of them is used: by a parameter `… Mode` (minimum / maximum)
// and a switch `Check Maximum …` (adds the maximum); lengths in the rule's name (mm, cm, m) compared as millimetres or metres

// ===========================================================================
// IMPORTS
// ===========================================================================

import { paramName } from './rules.ts';

import type { Rule } from './rules.ts';
import type { RuleParam } from './rules.ts';
import type { RuleRow } from './rules.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** hint on a rule; params: ids of the values it is about */
export type HintLevel = 'error' | 'warning' | 'info';
export type RuleHint = { level: HintLevel; text: string; params: string[] };
/** pair of limits and which of them the rule uses */
type Limits = { min: RuleParam; max: RuleParam; usesMin: boolean; usesMax: boolean; why: string; odd: string };

// ===========================================================================
// CONSTANTS
// ===========================================================================

const LENGTH_RE = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)(?![\p{L}\d])/giu;
const MIN_RE = /(?<![\p{L}])(?:min(?:imum|imal)?|mindestens|at least)(?![\p{L}])/iu;
const MAX_RE = /(?<![\p{L}])(?:max(?:imum|imal)?|höchstens|at most)(?![\p{L}])/iu;
const MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

// Hints per rule (same order as the rules): each rule on its own, then rules compared with each other
export function ruleHints(rules: Rule[]): RuleHint[][] {
    const out = rules.map((rule) => [
        ...limitHints(rule),
        ...nameHints(rule),
        ...filterHints(rule),
        ...houseHints(rule),
    ]);
    acrossRules(rules, out);
    return out;
}

/** @returns ids of the values a rule probably does not use (cf. its hints) */
export const unusedParams = (hints: RuleHint[]): Set<string> =>
    new Set(hints.filter((h) => h.level === 'info' && h.text.includes('probably not used')).flatMap((h) => h.params));

// Limits: used one probably ignored by the check mode; both used and min above max; mode and switch at odds
function limitHints(rule: Rule): RuleHint[] {
    const limits = limitsOf(rule);
    if (!limits) return [];
    const { min, max, usesMin, usesMax, why, odd } = limits;
    const out: RuleHint[] = [];
    if (!usesMin) out.push(info(`${paramName(min.id)} (${min.value}) is probably not used (${why})`, min));
    if (!usesMax) out.push(info(`${paramName(max.id)} (${max.value}) is probably not used (${why})`, max));
    if (odd) out.push(warning(odd, max));
    if (usesMin && usesMax && Number(min.value) > Number(max.value))
        out.push(error(`${paramName(min.id)} (${min.value}) is above ${paramName(max.id)} (${max.value})`, min, max));
    return out;
}

// Name and values: minimum / maximum named but the other one used; lengths named but not among the values used
function nameHints(rule: Rule): RuleHint[] {
    const limits = limitsOf(rule);
    if (!limits) return [];
    const { min, max, usesMin, usesMax } = limits;
    const out: RuleHint[] = [];
    const saysMin = MIN_RE.test(rule.name);
    const saysMax = MAX_RE.test(rule.name);
    if (saysMin && !saysMax && !usesMin && usesMax)
        out.push(warning(`the name says minimum, but the rule checks ${paramName(max.id)}`, max));
    if (saysMax && !saysMin && !usesMax && usesMin)
        out.push(warning(`the name says maximum, but the rule checks ${paramName(min.id)}`, min));
    const lengths = [...rule.name.matchAll(LENGTH_RE)].map((m) => ({
        text: m[0],
        mm: Number(m[1].replace(',', '.')) * MM[m[2].toLowerCase()],
    }));
    const used = [usesMin ? min : null, usesMax ? max : null].filter((p): p is RuleParam => !!p);
    const fits = (p: RuleParam, mm: number) => [1, 1000].some((f) => Math.abs(Number(p.value) * f - mm) < 1e-6);
    if (lengths.length && used.length && !lengths.some((l) => used.some((p) => fits(p, l.mm)))) {
        const values = used.map((p) => `${paramName(p.id)} ${p.value}`).join(', ');
        out.push(warning(`the name says ${lengths.map((l) => l.text).join(', ')}, the rule checks ${values}`, ...used));
    }
    return out;
}

// Filters: a row both included and excluded; empty filters
function filterHints(rule: Rule): RuleHint[] {
    const out: RuleHint[] = [];
    for (const p of rule.params) {
        if (p.kind !== 'Filter' && !p.rows) continue;
        const rows = p.rows || [];
        if (!rows.length) {
            out.push(info(`${paramName(p.id)} is empty`, p));
            continue;
        }
        const key = (r: RuleRow) => JSON.stringify([r.subject, r.property, r.operator, r.values]);
        const included = new Set(rows.filter((r) => r.state === 'include').map(key));
        if (rows.some((r) => r.state === 'exclude' && included.has(key(r))))
            out.push(error(`${paramName(p.id)} includes and excludes the same components`, p));
    }
    return out;
}

function houseHints(rule: Rule): RuleHint[] {
    const out: RuleHint[] = [];
    if (!rule.enabled) out.push(info('switched off: not part of the checks'));
    if (!rule.description) out.push(info('no explanation'));
    return out;
}

// Across rules: the same rule twice (other name); same filters, limits that cannot both hold
function acrossRules(rules: Rule[], out: RuleHint[][]) {
    const label = (r: Rule) => `“${r.name}”${r.path.length ? ` (${r.path.join(' / ')})` : ''}`;
    const same = new Map<string, number[]>();
    rules.forEach((r, i) => {
        const key = JSON.stringify([r.type, r.params.map((p) => [p.id, p.value, p.rows])]);
        same.set(key, [...(same.get(key) || []), i]);
    });
    for (const group of same.values())
        for (const i of group)
            for (const j of group) if (i !== j) out[i].push(warning(`same type and values as ${label(rules[j])}`));
    const filters = (r: Rule) => JSON.stringify([r.type, r.params.filter((p) => p.rows).map((p) => [p.id, p.rows])]);
    rules.forEach((a, i) => {
        const la = limitsOf(a);
        if (!la?.usesMin) return;
        rules.forEach((b, j) => {
            const lb = limitsOf(b);
            if (i === j || !lb?.usesMax || filters(a) !== filters(b) || !b.enabled || !a.enabled) return;
            if (Number(la.min.value) <= Number(lb.max.value)) return;
            const text = `cannot both hold: ${paramName(la.min.id)} ${la.min.value} here, ${paramName(lb.max.id)} ${lb.max.value} in ${label(b)} (same filters)`;
            out[i].push(error(text, la.min));
            out[j].push(
                error(
                    `cannot both hold: ${paramName(lb.max.id)} ${lb.max.value} here, ${paramName(la.min.id)} ${la.min.value} in ${label(a)} (same filters)`,
                    lb.max,
                ),
            );
        });
    });
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

// Pair `… Min` / `… Max` (numbers, same stem); used: as the check mode says (minimum / maximum; neither said: both),
// and the maximum also if the switch `Check Maximum …` is on; mode maximum, switch off: said (odd)
function limitsOf(rule: Rule): Limits | null {
    const named = (p: RuleParam) => paramName(p.id);
    const numeric = rule.params.filter((p) => !p.rows && p.value !== '' && Number.isFinite(Number(p.value)));
    const min = numeric.find((p) => / Min$/.test(named(p)));
    const max = min && numeric.find((p) => named(p) === named(min).replace(/ Min$/, ' Max'));
    if (!min || !max) return null;
    let usesMin = true;
    let usesMax = true;
    let odd = '';
    const why: string[] = [];
    const mode = rule.params.find((p) => !p.rows && / Mode$/.test(named(p)) && p.value);
    const isMin = !!mode && /minimum|(?<![\p{L}])min(?![\p{L}])/iu.test(mode.value);
    const isMax = !!mode && /maximum|(?<![\p{L}])max(?![\p{L}])/iu.test(mode.value);
    if (mode && isMin !== isMax) {
        usesMin = isMin;
        usesMax = isMax;
        why.push(`${named(mode)}: ${mode.value}`);
    }
    const toggle = rule.params.find((p) => !p.rows && /^Check Max/.test(named(p)) && /^(true|false)$/.test(p.value));
    if (toggle && toggle.value === 'true' && !usesMax) {
        usesMax = true;
        why.push(`${named(toggle)}: true`);
    } else if (toggle && toggle.value === 'false') {
        if (isMax && !isMin) odd = `${named(mode as RuleParam)} is ${mode?.value}, but ${named(toggle)} is off`;
        else if (usesMax) {
            usesMax = false;
            why.push(`${named(toggle)}: false`);
        }
    }
    return { min, max, usesMin, usesMax, why: why.join(', ') || 'no check mode', odd };
}

const hint =
    (level: HintLevel) =>
    (text: string, ...params: RuleParam[]): RuleHint => ({ level, text, params: params.map((p) => p.id) });
const error = hint('error');
const warning = hint('warning');
const info = hint('info');
