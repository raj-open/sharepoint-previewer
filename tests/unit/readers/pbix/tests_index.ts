import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.ts';
import { load } from '../../helpers.ts';
import { serve } from '../../helpers.ts';
import { zip } from '../../helpers.ts';

const {
    PBIX_RE,
    sectionQueries,
    parameterOf,
    schemaQueries,
    mashupQueries,
    treeLines,
    openPbixSource,
    decodePart,
    noQueries,
    prettyJson,
} = await load('readers/pbix/index.ts');
const { READ_MIN } = await load('readers/ranges.ts');
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
        assert.ok(lines.some((l: string) => /DataModel {2}\(.*data model \(queries read if needed\)\)/.test(l)));
    });

    it('source: Markdown with parts, parameters, queries; data model never fetched', async () => {
        const big = new Uint8Array(randomBytes(200_000)); // not compressible
        const layout = Buffer.from(JSON.stringify({ sections: [{ config: '{"name":"p1"}' }] }), 'utf16le');
        const { bytes } = zip({
            DataModel: big,
            DataMashup: mashup(SECTION),
            'Report/Layout': layout,
            'Report/StaticResources/a.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
            Version: '1.28',
        });
        const requests = serve({ '/r.pbix': bytes });
        const src = await openPbixSource('/r.pbix', signal, false, () => {});
        assert.ok(src.isZip && src.done);
        assert.match(src.text, /\n## Parts\n/);
        assert.match(src.text, /\| `Server` \| Text \| `"srv\\\|01"` \| yes \|/);
        assert.match(src.text, /### Sales "2026"\n\n```m\nlet/);
        // parts: overview first; text parts with language; data model and images not shown
        const [parts, queries] = src.parts;
        const part = (name: string) => parts.items.find((p: { name: string }) => p.name === name);
        assert.equal(parts.items[0].name, 'Overview');
        assert.equal(part('DataModel').text, null);
        assert.equal(part('Report/StaticResources/a.png').text, null);
        assert.equal(part('Report/Layout').lang, 'json');
        assert.match(part('Report/Layout').text, /"config": \{\n\s+"name": "p1"/);
        assert.equal(part('DataMashup').lang, 'm');
        assert.deepEqual(
            queries.items.map((q: { name: string; note: string }) => [q.name, q.note]),
            [
                ['Sales "2026"', ''],
                ['Server', 'parameter'],
            ],
        );
        // start and end of the archive only (directory, small parts): one request each, the data model in between
        const fetched = requests.reduce((n, r) => {
            const m = /bytes=(\d+)-(\d+)/.exec(r.range || '');
            return n + (m ? Number(m[2]) - Number(m[1]) + 1 : bytes.length);
        }, 0);
        assert.ok(requests.length <= 2, `${requests.length} requests`);
        assert.ok(fetched <= 2 * READ_MIN && fetched < big.length, `fetched ${fetched} bytes`);
    });

    it('no queries: says where they are and why not read (data model: .pbit), or nothing if the file has none', () => {
        const parts = (...names: string[]) => names.map((name) => ({ name }));
        const model = parts('DataModel', 'Report/Layout');
        assert.match(noQueries(model, []), /data model.*not read.*\.pbit/s);
        assert.match(noQueries(model, [], 'declined'), /not read \(declined\)/);
        assert.match(noQueries(model, [], 'bad block header'), /could not be read \(bad block header\)/);
        assert.match(noQueries(model, [], ''), /No Power Query scripts found \(data model read\)/);
        assert.match(noQueries(parts('DataMashup'), []), /No Power Query scripts found/);
        assert.equal(noQueries(parts('Report/Layout'), []), null);
        assert.equal(noQueries(parts('DataModel'), [{ name: 'q', body: 'let x = 1 in x' }]), null);
    });

    it('newer file (no DataMashup): queries read from the data model, asked first; declined: said why', async () => {
        serve({ '/m.pbix': fixture('Data/model.pbix') });
        const asked: [number, boolean | undefined][] = [];
        const src = await openPbixSource(
            '/m.pbix',
            signal,
            false,
            () => {},
            (bytes: number, model?: boolean) => {
                asked.push([bytes, model]);
                return true;
            },
        );
        assert.equal(asked.length, 2);
        assert.equal(asked[1][1], true);
        assert.deepEqual(
            src.parts[1].items.map((q: { name: string }) => q.name),
            ['ABC', 'BrokenColumns'],
        );
        assert.match(src.text, /## Queries \(2\)\n\nRead from the data model/);
        assert.match(src.text, /### ABC\n\n```m\nlet/);
        const declined = await openPbixSource(
            '/m.pbix',
            signal,
            false,
            () => {},
            (_: number, model?: boolean) => !model,
        );
        assert.deepEqual(declined.parts[1].items, []);
        assert.match(declined.text, /not read \(declined\)/);
    });

    it('parts: UTF-16LE without BOM, UTF-8, binary', () => {
        assert.equal(decodePart(Buffer.from('{"a":1}', 'utf16le')), '{"a":1}');
        assert.equal(decodePart(Buffer.from('<x/>')), '<x/>');
        assert.equal(decodePart(new Uint8Array([1, 0, 0, 2, 0])), null);
        // encrypted blob (as SecurityBindings): public DPAPI header (version 1, provider GUID), looks like UTF-16LE
        assert.equal(decodePart(new Uint8Array([1, 0, 0, 0, 0xd0, 0x8c, 0x9d, 0xdf, 1, 0x15, 0xd1, 0x11])), null);
        // invented bytes without NUL: not UTF-8
        assert.equal(decodePart(new Uint8Array([0x80, 0xc3, 0x28, 0xf5, 0x41, 0xfe, 0x7a])), null);
    });

    it('JSON: indented, numbers as written, JSON in strings unpacked', () => {
        assert.equal(
            prettyJson('{"n":12345678901234567890,"c":"[1,2]","s":"[x"}'),
            ['{', '  "n": 12345678901234567890,', '  "c": [', '    1,', '    2', '  ],', '  "s": "[x"', '}'].join('\n'),
        );
        assert.equal(prettyJson('not json'), 'not json');
    });

    it('asks before reading the parts (data model left out); declined: not opened', async () => {
        const { bytes } = zip({ DataModel: new Uint8Array(randomBytes(50_000)), Version: '1.28' });
        serve({ '/a.pbix': bytes });
        const asked: number[] = [];
        const decline = (n: number) => {
            asked.push(n);
            return false;
        };
        const src = await openPbixSource('/a.pbix', signal, false, () => {}, decline);
        assert.ok(asked.length === 1 && asked[0] < 100);
        assert.match(src.error, /Not opened/);
    });

    it('not an archive', async () => {
        serve({ '/x.pbix': 'no zip here' });
        const src = await openPbixSource('/x.pbix', signal, false, () => {});
        assert.match(src.error, /Not a valid Power BI file/);
    });
});
