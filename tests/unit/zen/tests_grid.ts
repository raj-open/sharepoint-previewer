// Zen list grid: values as edited (changes recorded, back to the original: none), items shown (folders first)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { cellValue, itemsShown, originalValue, setValue } = await load('zen/grid.ts');

const field = (name: string, type: string) => ({
    name,
    title: name,
    type,
    entity: name,
    textKey: name,
    editable: true,
    choices: [],
});
const item = (
    id: number,
    name: string,
    folder: boolean,
    text: Record<string, string>,
    raw: Record<string, unknown> = {},
) => ({
    id,
    name,
    path: `/sites/A/Docs/${name}`,
    folder,
    text: { FileLeafRef: name, ...text },
    raw: { FileLeafRef: name, ...raw },
});

function zen() {
    return {
        data: {
            fields: [
                field('FileLeafRef', 'File'),
                field('Due', 'DateTime'),
                field('Done', 'Boolean'),
                field('N', 'Number'),
            ],
            items: [
                item(
                    1,
                    'b.txt',
                    false,
                    { Due: '02/01/2026', N: '10' },
                    { Due: '2026-01-02T00:00:00Z', Done: true, N: 10 },
                ),
                item(2, 'Sub', true, {}),
                item(
                    3,
                    'a.txt',
                    false,
                    { Due: '01/02/2026', N: '9' },
                    { Due: '2026-02-01T00:00:00Z', Done: false, N: 9 },
                ),
            ],
        },
        sort: null as { col: string; dir: number } | null,
        filters: new Map(),
        pending: new Map(),
        errors: new Map(),
    };
}

describe('zen/grid', () => {
    it('original values: yes / no as 1 / 0, else the text shown', () => {
        const z = zen();
        assert.equal(originalValue(z.data.items[0], z.data.fields[2]), '1');
        assert.equal(originalValue(z.data.items[2], z.data.fields[2]), '0');
        assert.equal(originalValue(z.data.items[0], z.data.fields[1]), '02/01/2026');
    });

    it('changes recorded per item and field; back to the original: no change; error of the cell gone', () => {
        const z = zen();
        const it1 = z.data.items[0];
        z.errors.set(1, { N: 'bad' });
        setValue(z, it1, 'N', '11');
        assert.deepEqual(z.pending.get(1), { N: '11' });
        assert.equal(cellValue(z, it1, 'N'), '11');
        assert.equal(z.errors.has(1), false);
        setValue(z, it1, 'FileLeafRef', 'c.txt');
        setValue(z, it1, 'N', '10');
        assert.deepEqual(z.pending.get(1), { FileLeafRef: 'c.txt' });
        setValue(z, it1, 'FileLeafRef', 'b.txt');
        assert.equal(z.pending.size, 0);
    });

    it('shown: folders first; sorted by raw dates and numbers, not their text', () => {
        const z = zen();
        assert.deepEqual(
            itemsShown(z).map((x: { name: string }) => x.name),
            ['Sub', 'b.txt', 'a.txt'],
        );
        z.sort = { col: 'Due', dir: 1 };
        assert.deepEqual(
            itemsShown(z).map((x: { name: string }) => x.name),
            ['Sub', 'b.txt', 'a.txt'],
        );
        z.sort = { col: 'N', dir: 1 };
        assert.deepEqual(
            itemsShown(z).map((x: { name: string }) => x.name),
            ['Sub', 'a.txt', 'b.txt'],
        );
        z.sort = { col: 'FileLeafRef', dir: 1 };
        z.filters.set('FileLeafRef', { values: null, text: '.TXT' });
        assert.deepEqual(
            itemsShown(z).map((x: { name: string }) => x.name),
            ['a.txt', 'b.txt'],
        );
    });
});
