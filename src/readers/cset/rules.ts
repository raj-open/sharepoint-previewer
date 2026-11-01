// Solibri rulesets: rules read from the Java objects (read only), recognised by their fields, not their class names:
// rule: `controlParameters` (parameters: `nameID`, `value`); filter rows: `filterState`; folders: `classes` -> `entities`

// ===========================================================================
// IMPORTS
// ===========================================================================

import type { JavaNode } from '../java.ts';
import type { JavaValue } from '../java.ts';

// ===========================================================================
// TYPES
// ===========================================================================

/** row of a component filter: include / exclude / ignore components of a class, by a property and values */
export type RuleRow = { state: string; subject: string; property: string; operator: string; values: string[] };
/** parameter of a rule: its id, kind (e.g. `Length`), value as text, and rows if it is a component filter */
export type RuleParam = { id: string; kind: string; value: string; rows: RuleRow[] | null };
/** rule: folders above it (below the ruleset), name, class, on / off, explanation (plain text), parameters */
export type Rule = {
    path: string[];
    name: string;
    type: string;
    enabled: boolean;
    description: string;
    params: RuleParam[];
};

// ===========================================================================
// METHODS
// ===========================================================================

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// Rules of the objects, in the order of their folders; none found in folders: any objects with parameters
export function csetRules(roots: JavaValue[]): Rule[] {
    const out: Rule[] = [];
    const seen = new Set<JavaNode>();
    const walk = (x: JavaValue, path: string[], top: boolean) => {
        if (!isNode(x) || seen.has(x)) return;
        seen.add(x);
        if (javaField(x, 'controlParameters') !== undefined) {
            out.push(ruleOf(x, path));
            return;
        }
        const kids = children(x);
        const name = top ? '' : nameOf(x);
        for (const kid of kids) walk(kid, name ? [...path, name] : path, false);
    };
    for (const root of roots) walk(root, [], true);
    if (out.length) return out;
    for (const node of allNodes(roots))
        if (javaField(node, 'controlParameters') !== undefined) out.push(ruleOf(node, []));
    return out;
}

// Folder: its entries (per class of entry), each list in its own order (`index`)
function children(node: JavaNode): JavaNode[] {
    const kids = list(javaField(node, 'classes')).flatMap((c) =>
        isNode(c) ? list(javaField(javaField(c, 'entities'), 'value')) : [],
    );
    const index = (x: JavaNode) => Number(javaText(javaField(x, 'index'))) || 0;
    return kids.filter(isNode).sort((a, b) => index(a) - index(b));
}

const nameOf = (node: JavaNode): string =>
    javaText(javaField(node, 'descriptiveName')) ||
    javaText(javaField(node, 'shortName')) ||
    javaText(javaField(node, 'name'));

function ruleOf(node: JavaNode, path: string[]): Rule {
    const params = list(javaField(node, 'controlParameters'))
        .filter(isNode)
        .filter((p) => typeof javaField(p, 'nameID') === 'string')
        .map(paramOf);
    return {
        path,
        name: nameOf(node) || shortName(node.cls),
        type: shortName(node.cls),
        enabled: javaField(node, 'enabled') !== false,
        description: plainText(javaText(javaField(node, 'explanation'))),
        params,
    };
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

function paramOf(node: JavaNode): RuleParam {
    const value = javaField(node, 'value');
    const entries = list(value);
    const kind = shortName(node.cls).replace(/Parameter$/, '') || 'Value';
    const param = { id: String(javaField(node, 'nameID')), kind, value: '', rows: null as RuleRow[] | null };
    if (entries.length && entries.every((e) => isNode(e) && javaField(e, 'filterState') !== undefined)) {
        param.rows = (entries as JavaNode[]).map(rowOf);
        return param;
    }
    const chosen = own(node).map(javaText).filter(Boolean); // e.g. choice of a list (written by the class itself)
    if (chosen.length) param.value = chosen.join(', ');
    else if (entries.length && entries.every((e) => isNode(e) && list(e).length))
        param.value = entries.map((row) => list(row).map(javaText).join(' | ')).join('; '); // table
    else param.value = javaText(value);
    return param;
}

function rowOf(node: JavaNode): RuleRow {
    const ref = javaField(node, 'propertyReference');
    const named = [javaText(javaField(ref, 'propertySet')), javaText(javaField(ref, 'property'))].filter(Boolean);
    const scalars = isNode(ref) ? ref.fields.map(([, , v]) => v).filter((v) => !isNode(v)) : [];
    const op = javaField(node, 'operator');
    const ordinal = javaField(op, 'ordinal');
    return {
        state: javaText(javaField(node, 'filterState')),
        subject: javaText(javaField(node, 'clazz')),
        property: named.length ? named.join('.') : scalars.map(javaText).filter(Boolean).join(' '),
        operator: typeof ordinal === 'number' ? `#${ordinal}` : javaText(op),
        values: own(node)
            .flatMap((v) => (list(v).length ? list(v).map(javaText) : [javaText(v)]))
            .filter(Boolean),
    };
}

// Parameter id as words: own prefix left out (`ckGapMax` -> `Gap Max`)
export const paramName = (id: string): string =>
    id
        .replace(/^[a-z]+(?=[A-Z])/, '')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

// Class name without package and outer classes (`a.b.Outer$Inner` -> `Inner`)
const shortName = (cls: string): string => cls.slice(Math.max(cls.lastIndexOf('.'), cls.lastIndexOf('$')) + 1);

const isNode = (x: unknown): x is JavaNode => !!x && typeof x === 'object' && 'fields' in x;

// Field of an object (the subclass's, if both declare it); undefined: no such field
function javaField(x: JavaValue | undefined, name: string): JavaValue | undefined {
    if (!isNode(x)) return undefined;
    for (let i = x.fields.length - 1; i >= 0; i--) if (x.fields[i][1] === name) return x.fields[i][2];
    return undefined;
}

// What the class wrote itself, without raw blocks (e.g. sizes)
const own = (x: JavaValue | undefined): JavaValue[] =>
    isNode(x) ? x.data.filter((v) => !(v && typeof v === 'object' && 'block' in v)) : [];

// Elements of an array, a Vector (up to its count) or another collection; nulls left out
function list(x: JavaValue | undefined): JavaValue[] {
    if (!isNode(x)) return [];
    if (x.items) return x.items.filter((v) => v !== null);
    const array = javaField(x, 'elementData');
    if (isNode(array) && array.items) {
        const n = javaField(x, 'elementCount');
        return array.items.slice(0, typeof n === 'number' ? n : undefined).filter((v) => v !== null);
    }
    if (/^java\.util\.\w*(?:List|Set|Vector|Stack|Queue|Deque)$/.test(x.cls)) return own(x).filter((v) => v !== null);
    return [];
}

// Value as text: texts in several languages: the default one (else the first given); enums: their name;
// classes: their simple name; objects with a value: that value; lists: their elements
export function javaText(x: JavaValue | undefined): string {
    if (x === null || x === undefined) return '';
    if (typeof x !== 'object') return String(x);
    if ('enum' in x) return x.enum;
    if ('classOf' in x) return shortName(x.classOf);
    if ('block' in x) return '';
    const lang = javaField(x, 'defaultLanguage');
    if (lang !== undefined) {
        const pairs = own(x);
        const texts = new Map<string, string>();
        for (let i = 0; i + 1 < pairs.length; i += 2) texts.set(javaText(pairs[i]), javaText(pairs[i + 1]));
        return texts.get(javaText(lang)) || [...texts.values()].find(Boolean) || '';
    }
    const value = javaField(x, 'value');
    if (value !== undefined) return javaText(value);
    return list(x).map(javaText).filter(Boolean).join(', ');
}

// All objects reachable from the roots (each once)
function allNodes(roots: JavaValue[]): JavaNode[] {
    const out: JavaNode[] = [];
    const seen = new Set<JavaNode>();
    const stack = [...roots];
    while (stack.length) {
        const x = stack.pop();
        if (!isNode(x) || seen.has(x)) continue;
        seen.add(x);
        out.push(x);
        stack.push(...x.fields.map(([, , v]) => v), ...(x.items || []), ...x.data);
    }
    return out;
}

// HTML (explanations of rules) as plain text: paragraphs and breaks as new lines
export function plainText(html: string): string {
    if (!/<[a-z!/]/i.test(html)) return html.trim();
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return html
        .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/<(?:br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&(#x?[\da-f]+|\w+);/gi, (m, e: string) =>
            e[0] === '#'
                ? String.fromCodePoint(
                      e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
                  )
                : (entities[e.toLowerCase()] ?? m),
        )
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n');
}
