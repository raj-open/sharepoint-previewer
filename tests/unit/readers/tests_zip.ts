import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { reader } from '../helpers.ts';
import { serve } from '../helpers.ts';
import { zip } from '../helpers.ts';

const { zipEntries, zipEntryBytes, ZIP_RE, openZipSource } = await load('readers/zip.ts');
const signal = () => new AbortController().signal;

describe('readers/zip', () => {
    const { bytes, offsets } = zip({ 'a.txt': 'alpha', 'dir/b.ifc': 'ISO-10303-21;\nEND-ISO-10303-21;\n' });

    it('directory from the end of the archive', async () => {
        const entries = await zipEntries(reader(bytes).read, bytes.length);
        assert.deepEqual(
            entries.map((e) => [e.name, e.size, e.offset]),
            [
                ['a.txt', 5, offsets['a.txt'][0]],
                ['dir/b.ifc', 32, offsets['dir/b.ifc'][0]],
            ],
        );
    });

    it('one entry: only its bytes are read, unpacked', async () => {
        const r = reader(bytes);
        const entries = await zipEntries(r.read, bytes.length);
        r.ranges.length = 0;
        const out = await zipEntryBytes(r.read, entries[0]);
        assert.equal(new TextDecoder().decode(out), 'alpha');
        assert.ok(r.ranges.every(([a, b]) => a >= offsets['a.txt'][0] && b <= offsets['a.txt'][1]));
    });

    it('not an archive', async () => {
        const text = new TextEncoder().encode('no zip here');
        await assert.rejects(zipEntries(reader(text).read, text.length), /not a ZIP/);
    });

    it('.ifczip: the IFC inside, as text', async () => {
        assert.ok(ZIP_RE.test('model.IFCZIP'));
        serve({ '/m.ifczip': bytes });
        const src = await openZipSource('/m.ifczip', signal, false, () => {});
        assert.match(src.text, /^ISO-10303-21;/);
        assert.ok(src.isZip && src.done);
    });
});
