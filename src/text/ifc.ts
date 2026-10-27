// IFC (STEP) text: an entity by its id (type, name, line), e.g. for the object picked in the 3D view

// ===========================================================================
// TYPES
// ===========================================================================

/** entity `#id= TYPE(…)` of an IFC file; name: its Name (third argument of rooted entities), else '' */
export type IfcEntity = { id: number; type: string; name: string; line: number };

// ===========================================================================
// METHODS
// ===========================================================================

/** @returns entity `#id` of the IFC text, null if there is none */
export function ifcEntity(text: string, id: number): IfcEntity | null {
    const m = new RegExp(`(^|[\\r\\n;])[ \\t]*#${id}[ \\t]*=[ \\t]*([A-Za-z0-9_]+)[ \\t]*\\(`).exec(text);
    if (!m) return null;
    const start = m.index + m[1].length;
    let line = 1;
    for (let i = text.indexOf('\n'); i !== -1 && i < start; i = text.indexOf('\n', i + 1)) line++;
    const name = stepArgs(text, m.index + m[0].length, 3)[2] ?? '';
    return { id, type: m[2].toUpperCase(), name: stepString(name), line };
}

// First `count` arguments (as written) of the argument list starting at `from` (after its "(")
function stepArgs(text: string, from: number, count: number): string[] {
    const args: string[] = [];
    let depth = 0;
    let quoted = false;
    let start = from;
    for (let i = from; i < text.length && args.length < count; i++) {
        const c = text[i];
        if (quoted) {
            if (c === "'" && text[i + 1] === "'")
                i++; // '' is a quote inside
            else if (c === "'") quoted = false;
            continue;
        }
        if (c === "'") quoted = true;
        else if (c === '(') depth++;
        else if (c === ')' && depth > 0) depth--;
        else if ((c === ',' || c === ')') && depth === 0) {
            args.push(text.slice(start, i).trim());
            if (c === ')') break;
            start = i + 1;
        }
    }
    return args;
}

/** @param arg STEP string as written ('…'), else returned as '' @returns its text (\X2\…\X0\ and \X\hh decoded) */
export function stepString(arg: string): string {
    if (!/^'.*'$/s.test(arg)) return '';
    return arg
        .slice(1, -1)
        .replace(/''/g, "'")
        .replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/gi, (_, hex: string) =>
            String.fromCharCode(...(hex.match(/.{4}/g) as string[]).map((h) => parseInt(h, 16))),
        )
        .replace(/\\X\\([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
