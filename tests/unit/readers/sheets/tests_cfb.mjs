// Compound file (old Office): directory, streams, sectors read only where asked for
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixture, load, reader } from '../../helpers.mjs';

const { compoundFile } = await load('readers/sheets/cfb.js');

describe('readers/sheets/cfb', () => {
  it('finds the Workbook stream (any case), reads it', async () => {
    const bytes = fixture('Data/harvest.xls');
    const cfb = await compoundFile(reader(bytes).read, bytes.length);
    const entry = cfb.find('WORKBOOK');
    assert.ok(entry && entry.size > 0);
    const stream = await cfb.stream(entry);
    const head = await stream.bytes(0, 4);
    assert.deepEqual([...head], [0x09, 0x08, 0x10, 0x00]); // BOF record of BIFF8
    assert.equal(cfb.find('nothing'), undefined);
  });
  it('not a compound file', async () => {
    const bytes = new Uint8Array(1024);
    await assert.rejects(compoundFile(reader(bytes).read, bytes.length), /not an Office file/);
  });
});
