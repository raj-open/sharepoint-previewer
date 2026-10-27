// Power BI data model: backup decompressed, its files by name, Power Query from the model's metadata
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.ts';
import { load } from '../../helpers.ts';

const { modelBackup, backupFiles, modelQueries } = await load('readers/pbix/model.ts');
const { zipEntries, zipEntryBytes } = await load('readers/zip.ts');

const pbix = fixture('Data/model.pbix');
const read = async (from: number, to: number) => pbix.subarray(from, to);
const entry = (await zipEntries(read, pbix.length)).find((e: { name: string }) => e.name === 'DataModel');
const model: Uint8Array = await zipEntryBytes(read, entry);
const utf16 = (s: string) => new Uint8Array(Buffer.from(s, 'utf16le'));

describe('readers/pbix/model', () => {
    it('queries of a file without DataMashup: M partitions of the tables', async () => {
        let pauses = 0;
        const queries = await modelQueries(model, async () => {
            pauses++;
        });
        assert.deepEqual(
            queries.map((q: { name: string }) => q.name),
            ['ABC', 'BrokenColumns'],
        );
        assert.match(queries[0].body, /^let\n\s+Source = Table\.FromRows/);
        assert.match(queries[0].body, /in\n\s+#"Changed Type"$/);
        assert.ok(pauses > 0);
    });

    it('backup: files by name (metadata as SQLite)', async () => {
        const files = backupFiles(await modelBackup(model));
        assert.ok(files.names.includes('metadata.sqlitedb'));
        assert.equal(new TextDecoder().decode(files.file('metadata.sqlitedb').subarray(0, 15)), 'SQLite format 3');
        assert.equal(files.file('nothing.here'), null);
    });

    it('uncompressed backups as they are; unknown compressions refused', async () => {
        const plain = new Uint8Array([...utf16('﻿STREAM_STORAGE_SIGNATURE_)!@#$%^&*('), ...new Uint8Array(200)]);
        assert.equal(await modelBackup(plain), plain);
        const other = new Uint8Array([
            ...utf16('This backup was created using something else.'),
            ...new Uint8Array(200),
        ]);
        await assert.rejects(modelBackup(other), /unknown compression/);
        assert.throws(() => backupFiles(plain), /no backup directory/);
    });

    it('a stop while pausing stops the decompression', async () => {
        await assert.rejects(
            modelQueries(model, async () => {
                throw new DOMException('stopped', 'AbortError');
            }),
            { name: 'AbortError' },
        );
    });
});
