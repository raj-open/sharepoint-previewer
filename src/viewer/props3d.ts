// Property and quantity sets of an IFC element (own and from its type), read by ifc-lite's parser on first use

// ===========================================================================
// IMPORTS
// ===========================================================================

import type { IfcParser } from '@ifc-lite/parser';
import type { extractProjectUnits } from '@ifc-lite/parser';
import type { extractPropertiesOnDemand } from '@ifc-lite/parser';
import type { extractQuantitiesOnDemand } from '@ifc-lite/parser';
import type { extractTypePropertiesOnDemand } from '@ifc-lite/parser';
import type { extractTypeQuantitiesOnDemand } from '@ifc-lite/parser';
import type { mergeInheritedPropertySets } from '@ifc-lite/parser';
import type { mergeInheritedQuantitySets } from '@ifc-lite/parser';

// ===========================================================================
// TYPES
// ===========================================================================

/** parser part of ifc-lite as its bundle provides it (cf. /src/@apis/ifc-lite/main.ts) */
export type PropsLib = {
    IfcParser: typeof IfcParser;
    extractProjectUnits: typeof extractProjectUnits;
    extractPropertiesOnDemand: typeof extractPropertiesOnDemand;
    extractQuantitiesOnDemand: typeof extractQuantitiesOnDemand;
    extractTypePropertiesOnDemand: typeof extractTypePropertiesOnDemand;
    extractTypeQuantitiesOnDemand: typeof extractTypeQuantitiesOnDemand;
    mergeInheritedPropertySets: typeof mergeInheritedPropertySets;
    mergeInheritedQuantitySets: typeof mergeInheritedQuantitySets;
};

/** one set as shown: Pset (properties) or Qto (quantities); from: name of the type it comes from, else '' */
export type PropSet = { name: string; kind: 'Pset' | 'Qto'; from: string; rows: [string, string][] };

/** sets of an element by its express id */
export type PropsReader = (id: number) => Promise<PropSet[]>;

type Units = ReturnType<typeof extractProjectUnits>;
type Property = ReturnType<typeof extractPropertiesOnDemand>[number]['properties'][number];
type Quantity = ReturnType<typeof extractQuantitiesOnDemand>[number]['quantities'][number];

// ===========================================================================
// CONSTANTS
// ===========================================================================

// Measure of each quantity type (QuantityType of @ifc-lite/data: length, area, volume, count, weight, time, number)
const QUANTITY_MEASURES = ['LENGTHMEASURE', 'AREAMEASURE', 'VOLUMEMEASURE', '', 'MASSMEASURE', 'TIMEMEASURE', ''];

// ===========================================================================
// METHODS
// ===========================================================================

/**
 * @param bytes IFC file (copied when first read)
 * @returns reader of the sets of an element; the file is parsed on the first call only
 */
export function propsReader(lib: PropsLib, bytes: Uint8Array): PropsReader {
    const parse = async () => {
        const store = await new lib.IfcParser().parseColumnar(bytes.slice().buffer);
        return { store, units: lib.extractProjectUnits(store.source, store.entityIndex) };
    };
    let parsed: ReturnType<typeof parse> | null = null;
    const model = () => {
        if (parsed) return parsed;
        parsed = parse();
        parsed.catch(() => {
            parsed = null; // next call tries again
        });
        return parsed;
    };
    return async (id) => {
        const { store, units } = await model();
        const type = lib.extractTypePropertiesOnDemand(store, id);
        const typeQ = lib.extractTypeQuantitiesOnDemand(store, id);
        const psets = lib.extractPropertiesOnDemand(store, id);
        const qtos = lib.extractQuantitiesOnDemand(store, id);
        const pFrom = origin(psets, type?.typeName ?? '');
        const qFrom = origin(qtos, typeQ?.typeName ?? '');
        return [
            ...lib.mergeInheritedPropertySets(psets, type?.properties ?? []).map((set) => ({
                name: set.name,
                kind: 'Pset' as const,
                from: pFrom(set.name),
                rows: set.properties.map((p): [string, string] => [p.name, propertyText(p, units)]),
            })),
            ...lib.mergeInheritedQuantitySets(qtos, typeQ?.quantities ?? []).map((set) => ({
                name: set.name,
                kind: 'Qto' as const,
                from: qFrom(set.name),
                rows: set.quantities.map((q): [string, string] => [q.name, quantityText(q, units)]),
            })),
        ];
    };
}

/** @returns origin of a merged set by its name: '' (the element's own), else the name of its type */
export function origin(own: { name: string }[], typeName: string): (name: string) => string {
    const names = new Set(own.map((s) => s.name));
    return (name) => (names.has(name) ? '' : typeName);
}

/** @returns value of a property with its unit, e.g. "0.28 W/(m²·K)"; complex: "name: value; …" */
export function propertyText(p: Property, units: Pick<Units, 'unitForMeasure'>): string {
    if (p.members?.length) return p.members.map((m) => `${m.name}: ${propertyText(m, units)}`).join('; ');
    const value = formatValue(p.value);
    if (typeof p.value !== 'number') return value;
    const unit = p.unit ?? (p.dataType ? units.unitForMeasure(p.dataType)?.symbol : undefined);
    return unit ? `${value} ${unit}` : value;
}

/** @returns value of a quantity with its unit (declared on it, else the project's), e.g. "2.712 m³" */
export function quantityText(q: Quantity, units: Pick<Units, 'unitForMeasure'>): string {
    const measure = QUANTITY_MEASURES[q.type] ?? '';
    const unit = q.explicitUnit ?? (measure ? units.unitForMeasure(measure)?.symbol : undefined);
    const value = formatValue(q.value);
    return unit ? `${value} ${unit}` : value;
}

/** @returns value as text: numbers without float noise, lists joined, nothing as '' */
export function formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(formatValue).join(', ');
    if (typeof value === 'number') return String(Number(value.toPrecision(12)));
    return String(value);
}

// ---------------------------------------------------------------
// Display
// ---------------------------------------------------------------

/** fills el with the sets: one foldable table each, sets of the type marked as such */
export function showSets(el: HTMLElement, sets: PropSet[]): void {
    el.replaceChildren();
    if (!sets.length) {
        el.textContent = 'No property or quantity sets';
        return;
    }
    for (const set of sets) {
        const box = document.createElement('details');
        box.className = 'tp-3d-set';
        box.open = true;
        const head = document.createElement('summary');
        head.textContent = set.name;
        head.title = set.kind === 'Qto' ? 'Quantities' : 'Properties';
        if (set.from) {
            const note = document.createElement('span');
            note.className = 'tp-3d-from';
            note.textContent = `type: ${set.from}`;
            head.append(note);
        }
        const table = document.createElement('table');
        for (const [name, value] of set.rows) {
            const tr = document.createElement('tr');
            const key = document.createElement('td');
            const val = document.createElement('td');
            key.textContent = name;
            val.textContent = value;
            tr.append(key, val);
            table.append(tr);
        }
        box.append(head, table);
        el.append(box);
    }
}
