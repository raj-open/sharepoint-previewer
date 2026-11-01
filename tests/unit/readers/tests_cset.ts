// Solibri rulesets: every form (XML or Java objects; plain, zipped, gzipped), overview and parts

import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../helpers.ts';
import { load } from '../helpers.ts';
import { reader } from '../helpers.ts';
import { serve } from '../helpers.ts';
import { zip } from '../helpers.ts';

const { CSET_RE, csetParts, openCsetSource } = await load('readers/cset/index.ts');
const { zipEntries, zipEntryBytes } = await load('readers/zip.ts');
const signal = () => new AbortController().signal;

const XML = '<?xml version="1.0"?>\n<ruleset name="a">\n  <rule id="1"/>\n</ruleset>\n';
const zipped = fixture('Rules/rules.cset');
const { read } = reader(zipped);
const entries = await zipEntries(read, zipped.length);
const java: Uint8Array = await zipEntryBytes(read, entries[0]); // Java objects, unzipped

const brief = (parts: { name: string; note: string; lang: string | null }[]) =>
    parts.map((p) => [p.name, p.note.replace(/^[^,]*, /, ''), p.lang]);

describe('readers/cset', () => {
    it('file names', () => {
        assert.ok(CSET_RE.test('Rules.CSET') && !CSET_RE.test('rules.cset.bak'));
    });

    it('forms by their bytes: XML (UTF-8, UTF-16), zipped XML, Java objects (plain, zipped, gzipped)', async () => {
        const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(XML, 'utf16le')]);
        assert.deepEqual(brief(await csetParts('a.cset', new TextEncoder().encode(XML))), [['a.cset', 'XML', 'xml']]);
        assert.deepEqual(brief(await csetParts('a.cset', utf16)), [['a.cset', 'XML', 'xml']]);
        assert.deepEqual(brief(await csetParts('a.cset', zip({ 'in/a.cset': XML }).bytes)), [
            ['in/a.cset', 'XML', 'xml'],
        ]);
        assert.deepEqual(brief(await csetParts('a.cset', java)), [['a.cset', 'Java objects', 'json']]);
        assert.deepEqual(brief(await csetParts('a.cset', zlib.gzipSync(java))), [
            ['a.cset', 'gzip, Java objects', 'json'],
        ]);
        assert.deepEqual(brief(await csetParts('a.cset', zipped)), [
            ['Example rules.cset', 'Java objects', 'json'],
            ['1.0.0', 'text', null],
        ]);
        // archive inside an archive: path of both
        const nested = zip({ 'inner.zip': zip({ 'b.cset': XML }).bytes }).bytes;
        assert.deepEqual(brief(await csetParts('a.cset', nested)), [['inner.zip/b.cset', 'XML', 'xml']]);
    });

    it('Java objects as JSON; damaged ones and binary data: not shown, said why', async () => {
        const [part] = await csetParts('a.cset', java);
        const [set] = JSON.parse(part.text);
        assert.equal(set.name, 'Example rules');
        const [broken] = await csetParts('a.cset', java.subarray(0, 300));
        assert.equal(broken.text, null);
        assert.match(broken.note, /Java objects, not readable: stream ends early/);
        const [binary] = await csetParts('a.cset', new Uint8Array([0, 1, 2, 3, 0, 0, 7]));
        assert.deepEqual([binary.text, binary.note], [null, '7 B, not text']);
    });

    it('source: zipped Java objects: overview first (parts, classes, texts); read only', async () => {
        serve({ '/r.cset': zipped });
        const src = await openCsetSource('/r.cset', signal, false, () => {});
        assert.ok(src.isZip && src.done);
        assert.deepEqual(src.part, { list: 0, item: 0 });
        assert.deepEqual(src.info, [['ruleset', 'Solibri, ZIP, 2 entries']]);
        assert.match(src.text, /Solibri ruleset: ZIP, 2 entries\./);
        assert.match(
            src.text,
            /## Parts\n\n```\n├── 1\.0\.0 {2}\(0 B\)\n└── Example rules\.cset {2}\(\d+\.\d KB\)\n```/,
        );
        assert.match(src.text, /\| `example\.rules\.Rule` \| 2 \|/);
        assert.match(src.text, /### Texts: \d+\n\n```text\n[\s\S]*Walls have a fire rating/);
        assert.doesNotMatch(src.text, /\n(?:java\.util\.ArrayList|\[Ljava)/); // class names are no texts
        const [parts] = src.parts;
        assert.deepEqual(
            parts.items.map((p: { name: string; lang: string | null }) => [p.name, p.lang]),
            [
                ['Overview', 'md'],
                ['Example rules.cset', 'json'],
                ['1.0.0', null],
            ],
        );
    });

    it('source: XML alone shown at once, rules not read yet (said); not a ruleset: refused', async () => {
        serve({ '/x.cset': XML, '/z.cset': new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]) });
        const src = await openCsetSource('/x.cset', signal, false, () => {});
        assert.deepEqual(src.part, { list: 0, item: 1 });
        assert.deepEqual(src.info, [
            ['ruleset', 'Solibri, XML'],
            ['rules', 'not read from XML rulesets yet (shown as XML): no rules list, no diagrams'],
        ]);
        assert.match(src.parts[0].items[0].text, /> \[!WARNING\]\n> Rules: not read from XML rulesets yet/);
        assert.match(
            (await openCsetSource('/z.cset', signal, false, () => {})).error,
            /^Not a readable Solibri ruleset/,
        );
    });
});
