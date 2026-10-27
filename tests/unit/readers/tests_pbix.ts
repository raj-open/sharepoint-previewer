import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { serve } from '../helpers.ts';
import { zip } from '../helpers.ts';

const { PBIX_RE, sectionQueries, parameterOf, schemaQueries, mashupQueries, treeLines, openPbixSource } =
    await load('readers/pbix.ts');
const signal = () => new AbortController().signal;

const SECTION = [
    'section Section1;',
    '',
    'shared #"Sales ""2026""" = let',
    '    Source = Csv.Document(File.Contents("a;b.csv")), // a ; in a string and a comment',
    '    /* ; */ Rows = Table.SelectRows(Source, each [x] = ";")',
    'in',
    '    Rows;',
    '',
    'shared Server = "srv|01" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true];',
].join('\n');

// DataMashup: version, length, package parts (ZIP), then (here) nothing else
function mashup(section: string): Uint8Array {
    const parts = zip({ 'Formulas/Section1.m': section }).bytes;
    const head = Buffer.alloc(8);
    head.writeUInt32LE(parts.length, 4);
    return Buffer.concat([head, parts, Buffer.alloc(4)]);
}

describe('readers/pbix', () => {
    it('file names', () => {
        assert.ok(PBIX_RE.test('report.PBIX') && PBIX_RE.test('t.pbit'));
        assert.ok(!PBIX_RE.test('report.pbix.txt'));
    });

    it('queries: split outside strings, comments and brackets; quoted names', () => {
        const qs = sectionQueries(SECTION);
        assert.deepEqual(
            qs.map((q: { name: string }) => q.name),
            ['Sales "2026"', 'Server'],
        );
        assert.match(qs[0].body, /^let[\s\S]*in\n {4}Rows$/);
    });

    it('parameters from meta', () => {
        const [query, server] = sectionQueries(SECTION);
        assert.equal(parameterOf(query), null);
        assert.deepEqual(parameterOf(server), { type: 'Text', value: '"srv|01"', required: true });
    });

    it('model schema (.pbit): expressions and M partitions', () => {
        const json = JSON.stringify({
            model: {
                expressions: [{ name: 'P', kind: 'm', expression: '1 meta [IsParameterQuery=true]' }],
                tables: [
                    { name: 'T', partitions: [{ source: { type: 'm', expression: ['let', '  x = 1', 'in', '  x'] } }] },
                ],
            },
        });
        assert.deepEqual(schemaQueries(json), [
            { name: 'P', body: '1 meta [IsParameterQuery=true]' },
            { name: 'T', body: 'let\n  x = 1\nin\n  x' },
        ]);
    });

    it('mashup: package parts unpacked', async () => {
        const qs = await mashupQueries(mashup(SECTION));
        assert.equal(qs.length, 2);
    });

    it('tree: folders first, sizes and notes', () => {
        const entries = [
            { name: 'Version', size: 8 },
            { name: 'DataModel', size: 2048 },
            { name: 'Report/Layout', size: 10 },
            { name: 'Report/StaticResources/a.png', size: 1 },
        ];
        const lines = treeLines(entries);
        assert.equal(lines[0], '├── Report/');
        assert.ok(lines.some((l: string) => /── StaticResources\/$/.test(l)));
        assert.ok(lines.some((l: string) => /DataModel {2}\(.*data, not readable\)/.test(l)));
    });

    it('source: Markdown with parts, parameters, queries; data model never fetched', async () => {
        const big = new Uint8Array(randomBytes(200_000)); // not compressible
        const { bytes } = zip({ DataModel: big, DataMashup: mashup(SECTION), Version: '1.28' });
        const requests = serve({ '/r.pbix': bytes });
        const src = await openPbixSource('/r.pbix', signal, false, () => {});
        assert.ok(src.isZip && src.done);
        assert.match(src.text, /^## Parts\n/);
        assert.match(src.text, /\| `Server` \| Text \| `"srv\\\|01"` \| yes \|/);
        assert.match(src.text, /### Sales "2026"\n\n```m\nlet/);
        // directory (end of the archive) and the small parts only
        const fetched = requests.reduce((n, r) => {
            const m = /bytes=(\d+)-(\d+)/.exec(r.range || '');
            return n + (m ? Number(m[2]) - Number(m[1]) + 1 : bytes.length);
        }, 0);
        assert.ok(fetched < 10_000, `fetched ${fetched} bytes`);
    });

    it('not an archive', async () => {
        serve({ '/x.pbix': 'no zip here' });
        const src = await openPbixSource('/x.pbix', signal, false, () => {});
        assert.match(src.error, /Not a valid Power BI file/);
    });
});
