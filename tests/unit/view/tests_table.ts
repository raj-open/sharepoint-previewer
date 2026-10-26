// Table view: CSV parsing (rendering, sort, filter, editing: behavioural tests)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { parseCsv, QUOTE_MODES } = await load('view/table.ts');

describe('view/table', () => {
    it('quoted cells may hold delimiters, quotes and line breaks', () => {
        const rows = parseCsv('a,"b,c","say ""hi"""\n"two\nlines",x', ',');
        assert.deepEqual(
            rows.map((r) => [...r]),
            [
                ['a', 'b,c', 'say "hi"'],
                ['two\nlines', 'x'],
            ],
        );
    });
    it('original text per row (for rows not edited); CRLF', () => {
        const rows = parseCsv('a;b\r\nc;d', ';');
        assert.deepEqual(
            rows.map((r) => r.raw),
            ['a;b', 'c;d'],
        );
        assert.deepEqual([...rows[1]], ['c', 'd']);
    });
    it('multi-character delimiter', () => assert.deepEqual([...parseCsv('a  b', '  ')[0]], ['a', 'b']));
    it('quote styles as in Python csv', () =>
        assert.deepEqual(Object.keys(QUOTE_MODES), ['minimal', 'all', 'nonnumeric', 'none']));
});
