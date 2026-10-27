// XPress9 (Power BI data models): blocks of a real model; damaged and cut-off data refused
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.ts';
import { load } from '../../helpers.ts';

const { xpress9Session } = await load('readers/codecs/xpress9.ts');
const { zipEntries, zipEntryBytes } = await load('readers/zip.ts');

// Chunks of the DataModel part of a real file (single-threaded XPress9): [size, packed bytes]
const pbix = fixture('Data/model.pbix');
const read = async (from: number, to: number) => pbix.subarray(from, to);
const entry = (await zipEntries(read, pbix.length)).find((e: { name: string }) => e.name === 'DataModel');
const model: Uint8Array = await zipEntryBytes(read, entry);
const chunks: [number, Uint8Array][] = [];
for (let at = 102; at + 8 <= model.length; ) {
    const view = new DataView(model.buffer, model.byteOffset + at, 8);
    const packed = view.getUint32(4, true);
    chunks.push([view.getUint32(0, true), model.subarray(at + 8, at + 8 + packed)]);
    at += 8 + packed;
}

describe('readers/codecs/xpress9', () => {
    it('a session: chunks in order, each as large as stated; output starts as a backup', () => {
        const session = xpress9Session(1024); // grows as needed
        for (const [size, data] of chunks) assert.equal(session.decode(data).length, size);
        const out = session.output();
        assert.equal(
            out.length,
            chunks.reduce((n, [size]) => n + size, 0),
        );
        assert.equal(
            new TextDecoder('utf-16le', { ignoreBOM: true }).decode(out.subarray(0, 72)),
            '﻿STREAM_STORAGE_SIGNATURE_)!@#$%^&*(',
        );
    });

    it('damaged or cut-off blocks are refused', () => {
        const [, first] = chunks[0];
        const bad = first.slice();
        bad[0] ^= 1;
        assert.throws(() => xpress9Session().decode(bad), /bad block header/);
        assert.throws(() => xpress9Session().decode(first.subarray(0, first.length - 1)), /cut off/);
        const noise = first.slice();
        for (let i = 64; i < noise.length; i += 7) noise[i] ^= 0x5a;
        assert.throws(() => xpress9Session().decode(noise), /XPress9/);
    });
});
