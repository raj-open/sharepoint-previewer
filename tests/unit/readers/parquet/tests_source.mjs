// Parquet source: footer and needed column parts by range, rows step by step as CSV
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../../helpers.mjs';
import { load } from '../../helpers.mjs';
import { serve } from '../../helpers.mjs';

const { openParquetSource } = await load('readers/parquet/source.js');
const signal = () => new AbortController().signal;

describe('readers/parquet/source', () => {
    for (const name of ['people.parquet', 'sensors.parquet']) {
        it(`${name}: header and rows as CSV, by range`, async () => {
            const requests = serve({ [`/${name}`]: fixture(`Data/${name}`) });
            const src = await openParquetSource(`/${name}`, signal, false, () => {});
            const lines = src.text.split('\n');
            assert.ok(lines.length >= 2);
            assert.ok(src.info.some(([k]) => k === 'shape'));
            assert.equal(src.format, 'Parquet');
            assert.ok(requests.every((r) => r.range));
        });
    }
    it('people.parquet holds Grace', async () => {
        serve({ '/p.parquet': fixture('Data/people.parquet') });
        const src = await openParquetSource('/p.parquet', signal, false, () => {});
        await src.loadAll();
        assert.match(src.text, /Grace/);
        assert.ok(src.done);
    });
    it('not a Parquet file', async () => {
        serve({ '/x.parquet': 'definitely not parquet' });
        assert.match((await openParquetSource('/x.parquet', signal, false, () => {})).error, /Not a Parquet file/);
    });
});
