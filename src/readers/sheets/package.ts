// Packages (ZIP): parts by path, relationships between them

// ===========================================================================
// IMPORTS
// ===========================================================================

import { zipEntries } from '../zip.ts';
import { zipEntryBytes } from '../zip.ts';
import { scanXml } from './xml.ts';
import { xmlAttrs } from './xml.ts';
import { xmlString } from './xml.ts';

import type { ByteReader } from '../../_core/types.ts';
import type { Package } from '../../_core/types.ts';

// ===========================================================================
// METHODS
// ===========================================================================

export async function zipPackage(read: ByteReader, size: number): Promise<Package> {
    const entries = await zipEntries(read, size);
    const byName = new Map(entries.map((e) => [e.name.replace(/\\/g, '/').toLowerCase(), e])); // some writers use \
    const entry = (path?: string) => (path ? byName.get(path.replace(/^\//, '').toLowerCase()) : undefined);
    const bytes = async (path?: string) => {
        const e = entry(path);
        return e ? zipEntryBytes(read, e) : null;
    };
    const text = async (path?: string) => {
        const b = await bytes(path);
        return b ? xmlString(b) : null;
    };
    const paths = () => [...byName.keys()];
    return { paths, entry, bytes, text };
}

// Path of target, relative to folder of `base` (or from root with leading "/")
function partPath(base: string, target: string): string {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/').slice(0, -1);
    for (const p of target.split('/')) {
        if (p === '..') parts.pop();
        else if (p && p !== '.') parts.push(p);
    }
    return parts.join('/');
}

/** @returns "xl/workbook.xml" -> "xl/_rels/workbook.xml.rels" */
const relsPath = (part: string): string => part.replace(/[^/]*$/, (n) => `_rels/${n}.rels`);

// Relationships of a part: id -> { path, type }
export async function partRels(pkg: Package, part: string): Promise<Map<string, { path: string; type: string }>> {
    const out = new Map();
    const xml = await pkg.text(relsPath(part));
    if (!xml) return out;
    scanXml(
        xml,
        (n, a) => {
            if (n !== 'Relationship') return;
            const at = xmlAttrs(a);
            if (at.TargetMode !== 'External' && at.Target) {
                out.set(at.Id, { path: partPath(part, at.Target), type: at.Type || '' });
            }
        },
        () => {},
    );
    return out;
}
