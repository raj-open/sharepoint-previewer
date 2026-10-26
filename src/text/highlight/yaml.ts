// YAML highlighting

// ===========================================================================
// IMPORTS
// ===========================================================================

import { stripYamlComment } from '../lint/yaml.ts';
import { tokenise } from './tokenise.ts';

import type { Token } from '../../_core/types.ts';

// ===========================================================================
// CONSTANTS
// ===========================================================================

const YAML_SCALAR_RE =
    /^(true|false|yes|no|on|off|null|~|[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+|\.inf|\.nan)|0x[0-9a-fA-F]+|0o[0-7]+)$/i;
export const YAML_KEY_RE = /^("(?:\\.|[^"\\])*"|'(?:[^']|'')*'|[^\s#'"[\]{},&*!|>%@`][^#]*?)(\s*:)(?=\s|$)/;
const YAML_VALUE_RE = new RegExp(
    [
        /("(?:\\.|[^"\\])*"?|'(?:[^']|'')*'?)/.source, // 1 quoted string
        /((?:^|(?<=\s))#.*$)/.source, // 2 comment
        /([&*][^\s,[\]{}]+)/.source, // 3 anchor / alias
        /(![^\s]*)/.source, // 4 tag
        /((?<=^\s*)[|>][-+0-9]*(?=\s*(?:#.*)?$)|[[\]{},])/.source, // 5 block indicator / flow punctuation
    ].join('|'),
    'g',
);

// ===========================================================================
// METHODS
// ===========================================================================

function yamlValue(s: string, out: Token[]): void {
    out.push(
        ...tokenise(
            s,
            YAML_VALUE_RE,
            (m, o) => {
                if (m[1]) o.push(['str', m[1]]);
                else if (m[2]) o.push(['com', m[2]]);
                else if (m[3]) o.push(['anchor', m[3]]);
                else if (m[4]) o.push(['meta', m[4]]);
                else o.push(['punct', m[5]]);
            },
            (plain, o) => {
                const lead = plain.match(/^\s*/)?.[0] ?? '';
                const trail = plain.slice(lead.length).match(/\s*$/)?.[0] ?? '';
                const core = plain.slice(lead.length, plain.length - trail.length);
                if (lead) o.push(['', lead]);
                if (core) {
                    const cls = !YAML_SCALAR_RE.test(core) ? 'str' : /^[-+]?[\d.]/.test(core) ? 'num' : 'lit';
                    o.push([cls, core]);
                }
                if (trail) o.push(['', trail]);
            },
        ),
    );
}

export function highlightYaml(text: string): Token[] {
    const out: Token[] = [];
    let blockIndent: number | null = null; // inside a | or > block scalar: lines are plain string content
    text.split('\n').forEach((line, i) => {
        if (i) out.push(['', '\n']);
        const indent = line.match(/^ */)?.[0].length ?? 0;
        if (blockIndent !== null) {
            if (!line.trim() || indent > blockIndent) {
                out.push(['str', line]);
                return;
            }
            blockIndent = null;
        }
        if (/(?:^|:\s+|-\s+)(?:[&!][^\s]*\s+)*[|>][-+0-9]*$/.test(stripYamlComment(line).trim())) {
            blockIndent = indent;
        }
        const doc = line.match(/^(---|\.\.\.)(?=\s|$)/);
        if (doc) {
            out.push(['kw', doc[1]]);
            yamlValue(line.slice(3), out);
            return;
        }
        if (/^\s*#/.test(line)) {
            out.push(['com', line]);
            return;
        }
        const lead = line.match(/^(\s*)((?:-(?:\s+|$))*)/) as RegExpMatchArray; // all parts optional: always matches
        if (lead[1]) out.push(['', lead[1]]);
        if (lead[2]) out.push(['punct', lead[2]]);
        let rest = line.slice(lead[0].length);
        const key = rest.match(YAML_KEY_RE);
        if (key) {
            out.push(['key', key[1]], ['punct', key[2]]);
            rest = rest.slice(key[0].length);
        }
        yamlValue(rest, out);
    });
    return out;
}
