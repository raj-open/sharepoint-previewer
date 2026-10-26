// YAML checks

// ===========================================================================
// IMPORTS
// ===========================================================================

import { YAML_KEY_RE } from '../highlight/yaml.ts';
import { collector } from './core.ts';

import type { LintResult } from '../../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

// Remove "# comment" at end of line, if it is outside quotes
export function stripYamlComment(line: string): string {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === '\\' && quote === '"') i++;
            else if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
            return line.slice(0, i);
        }
    }
    return line;
}

// Lightweight structural checks (no full YAML parser available without libraries)
export function lintYaml(text: string): LintResult {
    const { problems, add } = collector();
    const stack = [{ indent: -1, keys: new Set(), lastValue: false }];
    const top = () => stack[stack.length - 1];
    let blockIndent: number | null = null; // inside a | or > block scalar

    text.split(/\r?\n/).forEach((raw, idx) => {
        const n = idx + 1;
        const indent = raw.match(/^ */)?.[0].length ?? 0;

        if (blockIndent !== null) {
            if (!raw.trim() || indent > blockIndent) return;
            blockIndent = null;
        }
        if (/^ *\t/.test(raw)) add(n, 'Tab character used for indentation (YAML allows spaces only)');

        const line = stripYamlComment(raw).replace(/\s+$/, '');
        if (!line.trim()) return;
        if (/^(---|\.\.\.)(\s|$)/.test(line)) {
            stack.length = 1;
            stack[0].keys = new Set();
            stack[0].lastValue = false;
            return;
        }

        const lead = line.match(/^( *)((?:- +|-$)*)/) as RegExpMatchArray; // all optional: always matches
        const rest = line.slice(lead[0].length);
        const col = lead[0].length;
        const key = rest.match(YAML_KEY_RE);

        if (!key) {
            if (lead[2] && /^[|>][-+0-9]*$/.test(rest.trim())) blockIndent = lead[1].length;
            return;
        }

        if (lead[2]) {
            // "- key: value": new mapping in list item
            while (stack.length > 1 && top().indent >= col) stack.pop();
            stack.push({ indent: col, keys: new Set(), lastValue: false });
        } else {
            while (stack.length > 1 && top().indent > col) stack.pop();
            if (top().indent < col) {
                if (top().lastValue && top().indent >= 0) {
                    add(n, 'Unexpected indentation: the key above already has a value on its own line');
                }
                stack.push({ indent: col, keys: new Set(), lastValue: false });
            }
        }

        const name = key[1].replace(/^(["'])([\s\S]*)\1$/, '$2');
        const t = top();
        if (t.keys.has(name)) add(n, `Duplicate key "${name}"`);
        t.keys.add(name);

        const value = rest.slice(key[0].length).trim();
        const valueNoProps = value.replace(/^(?:[&!][^\s]*\s*)+/, '');
        if (/^[|>][-+0-9]*$/.test(valueNoProps)) {
            blockIndent = col;
            t.lastValue = true;
        } else {
            t.lastValue = valueNoProps !== '';
        }
        if (/^"/.test(valueNoProps) && !/^"(?:\\.|[^"\\])*"/.test(valueNoProps)) {
            add(n, 'Double-quoted string is not closed on this line', 'warning');
        }
        if (/^'/.test(valueNoProps) && !/^'(?:[^']|'')*'/.test(valueNoProps)) {
            add(n, 'Single-quoted string is not closed on this line', 'warning');
        }
    });
    return { problems, info: 'basic checks' };
}
