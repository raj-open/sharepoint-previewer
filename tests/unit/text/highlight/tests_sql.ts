// Highlighter: sql (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { classesOf } from '../../helpers.ts';
import { joined } from '../../helpers.ts';
import { load } from '../../helpers.ts';

const { highlightSql } = await load('text/highlight/sql.ts');
const SAMPLE = "SELECT a, COUNT(*) FROM t WHERE b = 'x' -- c\n";

describe('text/highlight/sql', () => {
    const tokens = highlightSql(SAMPLE);
    it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
    it('empty text', () => assert.equal(joined(highlightSql('')), ''));
    it('classes', () => {
        assert.ok(classesOf(tokens, 'SELECT').includes('kw'), 'SELECT');
        assert.ok(classesOf(tokens, 'COUNT').includes('enum'), 'COUNT');
        assert.ok(classesOf(tokens, 'FROM').includes('kw'), 'FROM');
    });
});
