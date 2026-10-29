// ZIP archives written in the browser: read back by the reader of the userscript (stored and deflated, folders, UTF-8)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { crc32, dosDate, packZip } = await load('zen/pack.ts');
const { zipEntries, zipEntryBytes } = await load('readers/zip.ts');

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('zen/pack', () => {
    it('CRC-32 (check value of "123456789")', () => {
        assert.equal(crc32(bytes('123456789')), 0xcbf43926);
        assert.equal(crc32(new Uint8Array(0)), 0);
    });

    it('MS-DOS dates: local time in 2 s steps; before 1980: 1980-01-01', () => {
        assert.deepEqual(dosDate(new Date(2026, 9, 29, 13, 45, 31)), {
            time: (13 << 11) | (45 << 5) | 15,
            date: (46 << 9) | (10 << 5) | 29,
        });
        assert.deepEqual(dosDate(new Date(1970, 0, 1)), { time: 0, date: 33 });
    });

    it('archive: files (deflated if smaller, else stored), folders, UTF-8 names; read back as written', async () => {
        const long = 'abc '.repeat(1000);
        const date = new Date(2026, 0, 2, 3, 4, 6);
        const zip = await packZip([
            { path: 'Sub', bytes: null, date },
            { path: 'Sub/long.txt', bytes: bytes(long), date },
            { path: 'Ä short.txt', bytes: bytes('x'), date },
            { path: 'empty.txt', bytes: new Uint8Array(0), date },
        ]);
        assert.ok(zip instanceof Blob);
        const all = new Uint8Array(await zip.arrayBuffer());
        const read = async (from: number, to: number) => all.subarray(from, to);
        const entries = await zipEntries(read, all.length);
        assert.deepEqual(
            entries.map((e: { name: string; method: number }) => [e.name, e.method]),
            [
                ['Sub/', 0],
                ['Sub/long.txt', 8],
                ['Ä short.txt', 0],
                ['empty.txt', 0],
            ],
        );
        assert.equal(text(await zipEntryBytes(read, entries[1])), long);
        assert.equal(text(await zipEntryBytes(read, entries[2])), 'x');
        assert.equal((await zipEntryBytes(read, entries[3])).length, 0);
    });

    it('too many entries: refused', async () => {
        const many = Array.from({ length: 0x10000 }, (_, i) => ({ path: `${i}`, bytes: null, date: new Date() }));
        assert.match(await packZip(many), /more than 65,535 entries/);
    });
});
