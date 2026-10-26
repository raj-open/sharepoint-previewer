// Parquet values as text: logical / converted types
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.ts';

const { valueText } = await load('readers/parquet/values.ts');

describe('readers/parquet/values', () => {
    it('null stays null; plain numbers', () => {
        assert.equal(valueText({}, null), null);
        assert.equal(valueText({}, 42), '42');
    });
    it('DATE (days since 1970)', () => assert.equal(valueText({ converted: 6 }, 20000), '2024-10-04'));
    it('DECIMAL with scale', () => assert.equal(valueText({ converted: 5, scale: 2 }, 12345), '123.45'));
    it('TIMESTAMP_MILLIS', () => assert.equal(valueText({ converted: 9 }, 0), '1970-01-01T00:00:00.000Z'));
    it('UTF8 strings', () => assert.equal(valueText({ converted: 0 }, new TextEncoder().encode('Grüße')), 'Grüße'));
    it('lists', () => assert.equal(valueText({}, [1, null, 3]), '["1",null,"3"]'));
});
