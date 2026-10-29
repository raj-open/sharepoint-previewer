// Configuration per deployment: links of the tab "About" are http(s) URLs with labels, one entry per line
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';
import { ROOT } from '../helpers.ts';

const { ABOUT_LINKS } = await load('_core/config.ts');

describe('config', () => {
    it('ABOUT_LINKS: labels with http(s) URLs', () => {
        for (const [label, url] of Object.entries(ABOUT_LINKS)) {
            assert.ok(label, 'label');
            assert.match(String(url), /^https?:\/\/\S+$/);
        }
    });

    it('ABOUT_LINKS: one line per link (removable by commenting out one line)', () => {
        const text = fs.readFileSync(path.join(ROOT, 'src/_core/config.ts'), 'utf8');
        const body = /ABOUT_LINKS[^=]*= \{\n([\s\S]*?)\n\};/.exec(text)?.[1] ?? '';
        assert.equal(body.split('\n').length, Object.keys(ABOUT_LINKS).length);
    });

    it('the first module of the userscript (at its very top, after the header)', () => {
        const main = fs.readFileSync(path.join(ROOT, 'src/main.ts'), 'utf8');
        const first = main.split('\n').find((line) => line.startsWith('import '));
        assert.equal(first, "import './_core/config.ts';");
    });
});
