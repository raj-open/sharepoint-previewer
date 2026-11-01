// Solibri rulesets: rules as Markdown, one section per rule (folders as top headings), each with a flowchart
// (Mermaid, https://mermaid.js.org): component filters into the rule (filters "to" / "target" out of it), its values

// ===========================================================================
// IMPORTS
// ===========================================================================

import { ruleHints } from './hints.ts';
import { unusedParams } from './hints.ts';
import { paramName } from './rules.ts';

import type { RuleHint } from './hints.ts';
import type { Rule } from './rules.ts';
import type { RuleRow } from './rules.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const MAX_ROWS = 8; // rows of a filter in its box
const MAX_ROW_VALUES = 4; // values of a row in its box
const MAX_LABEL = 80; // characters of a line in a box
const SIGNS: Record<string, string> = { include: '+', exclude: '−', ignore: '○' };
const TARGET_RE = /\b(?:to|target|targets)\b/i; // filters the rule leads to (e.g. distance from … to …)

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

// Rules of the ruleset: those at its top first, then per folder (heading of level 1), one section each;
// hints (cf. /src/readers/cset/hints.ts): counted in the overview, listed per rule (to check: warning, else note)
export function rulesMarkdown(rules: Rule[]): string {
    const hints = new Map(ruleHints(rules).map((h, i) => [rules[i], h]));
    const sorted = [...rules.filter((r) => !r.path.length), ...rules.filter((r) => r.path.length)];
    const count = (level: string) => rules.filter((r) => hints.get(r)?.some((h) => h.level === level)).length;
    const [errors, warnings] = [count('error'), count('warning')];
    const folders = new Set(rules.map((r) => r.path.join(' / ')).filter(Boolean)).size;
    const off = rules.filter((r) => !r.enabled).length;
    const out = [
        `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}` +
            (folders ? ` in ${folders} ${folders === 1 ? 'folder' : 'folders'}` : '') +
            (off ? `, ${off} switched off` : '') +
            '.',
        '',
        'Rules: list on the left (search, ↑ / ↓). Diagrams: Mermaid if its file is set up, else a simple drawing.',
    ];
    if (errors || warnings) {
        const n = (k: number, what: string) => `${k} ${k === 1 ? 'rule' : 'rules'} with ${what}`;
        const counts = [errors ? n(errors, 'errors') : '', warnings ? n(warnings, 'warnings') : ''].filter(Boolean);
        out.push(
            '',
            '> [!NOTE]',
            `> ${counts.join(', ')}: marked in the list (red: errors, amber: warnings, blue: info), filter above it.`,
            '> Hints come from the values alone, not from Solibri: rules of thumb.',
        );
    }
    let group = '';
    for (const rule of sorted) {
        const path = rule.path.join(' / ');
        if (path !== group) out.push('', `# ${literal(path)}`);
        group = path;
        out.push('', ...ruleMarkdown(rule, hints.get(rule) || []));
    }
    return `${out.join('\n')}\n`;
}

function ruleMarkdown(rule: Rule, hints: RuleHint[]): string[] {
    const unused = unusedParams(hints);
    const out = [`## ${literal(rule.name)}`, '', `\`${rule.type}\` · ${rule.enabled ? 'on' : 'switched off'}`];
    for (const [level, alert] of [
        ['error', 'CAUTION'],
        ['warning', 'WARNING'],
        ['info', 'NOTE'],
    ]) {
        const texts = hints.filter((h) => h.level === level).map((h) => `> - ${literal(h.text)}`);
        if (texts.length) out.push('', `> [!${alert}]`, ...texts);
    }
    out.push('', '```mermaid', ruleMermaid(rule, unused), '```');
    if (rule.params.length) {
        out.push('', '| Parameter | Value |', '| --- | --- |');
        for (const p of rule.params) {
            const value = p.rows ? p.rows.map(rowText).join('; ') : p.value;
            const mark = unused.has(p.id) ? ' *(probably not used)*' : '';
            out.push(`| ${literal(paramName(p.id))} | ${literal(value) || '–'}${mark} |`);
        }
    }
    if (rule.description) out.push('', ...rule.description.split('\n').map((l) => `> ${literal(l)}`));
    return out;
}

// Markdown marks taken literally (names and values may hold `*`, `_`, `|`, …)
const literal = (s: string): string => s.replace(/[\\`*_[\]<>|~#!]/g, '\\$&');

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

// Flowchart of a rule: filters (rows) -> rule (its values) -> filters it leads to
export function ruleMermaid(rule: Rule, unused: Set<string> = new Set()): string {
    const filters = rule.params.filter((p) => p.rows);
    const values = rule.params.filter((p) => !p.rows && p.value);
    const title = rule.enabled ? rule.name : `${rule.name} (switched off)`;
    const lines = [
        'flowchart LR',
        `    rule("${label([title, ...values.map((p) => `${paramName(p.id)}: ${p.value}${unused.has(p.id) ? ' (probably not used)' : ''}`)])}")`,
    ];
    filters.forEach((p, i) => {
        const rows = (p.rows as RuleRow[]).slice(0, MAX_ROWS).map(rowText);
        if ((p.rows as RuleRow[]).length > MAX_ROWS) rows.push(`… ${(p.rows as RuleRow[]).length - MAX_ROWS} more`);
        lines.push(`    f${i}["${label([paramName(p.id), ...rows])}"]`);
        lines.push(TARGET_RE.test(paramName(p.id)) ? `    rule --> f${i}` : `    f${i} --> rule`);
    });
    return lines.join('\n');
}

// Row of a filter: sign (+ include, − exclude, ○ ignore), class, property, operator, values
export function rowText(row: RuleRow): string {
    const values = row.values.slice(0, MAX_ROW_VALUES).join(', ') + (row.values.length > MAX_ROW_VALUES ? ', …' : '');
    const what = [row.property, row.operator && `op ${row.operator.replace(/^#/, '')}`].filter(Boolean).join(' ');
    return `${SIGNS[row.state] || row.state} ${row.subject}${what ? ` · ${what}` : ''}${values ? `: ${values}` : ''}`;
}

// Lines of a box: entities for what Mermaid reads itself (quotes, angle brackets, #), lines cut, joined by breaks
const label = (lines: string[]): string =>
    lines
        .map((l) => (l.length > MAX_LABEL ? `${l.slice(0, MAX_LABEL - 1)}…` : l))
        .map((l) => l.replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;'))
        .join('<br/>');
