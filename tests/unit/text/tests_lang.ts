import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { langOf, indentation, LANG_NAMES } = await load('text/lang.ts');

describe('text/lang', () => {
    it('language by extension', () => {
        const names = ['a.json', 'b.XML', 'c.yml', 'd.ifczip', 'e.pq', 'f.csv', 'g.tsv', 'h.addin', 'i.txt'];
        assert.deepEqual(names.map(langOf), ['json', 'xml', 'yaml', 'ifc', 'm', 'csv', 'csv', 'xml', null]);
    });
    it('every language has a display name', () => {
        for (const lang of ['json', 'xml', 'yaml', 'ifc', 'toml', 'm', 'js', 'md', 'rst', 'csv', 'xlf', 'sql', 'py'])
            assert.ok(LANG_NAMES[lang], lang);
    });
    it('indentation', () => {
        assert.equal(indentation('a\n  b\n    c\n  d'), '2 spaces');
        assert.equal(indentation('a\n\tb\n\t\tc'), 'tabs');
        assert.equal(indentation('a\nb'), 'none');
        assert.equal(indentation(''), null);
    });
});
