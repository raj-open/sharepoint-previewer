// Crumbs of the Zen list: library (menu only if the site has others), folders below it
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import type { Fake } from '../helpers.ts';
import { element } from '../helpers.ts';
import { load } from '../helpers.ts';

const { showCrumbs } = await load('zen/crumbs.ts');

const LIB = '/sites/A/Shared Documents';
const OWN = { title: 'Documents', url: `${LIB}/Forms/AllItems.aspx`, folder: LIB };
const OTHER = { title: 'Reports', url: '/sites/A/Reports/Forms/AllItems.aspx', folder: '/sites/A/Reports' };

const zenOf = (folder: string, libraries: Fake[] | null = null): Fake => ({
    crumbs: element(),
    folder,
    libraries,
    data: { title: 'Documents' },
});

describe('zen/crumbs', () => {
    it('library, then the folders below it (links but the last); libraries not read yet', () => {
        const z = zenOf(`${LIB}/X/Y`);
        showCrumbs(z, LIB);
        const html: string = z.crumbs.innerHTML;
        assert.match(html, /^<a data-folder="\/sites\/A\/Shared Documents"[^>]*>Documents<\/a>/);
        assert.match(html, /<a data-folder="\/sites\/A\/Shared Documents\/X"[^>]*>X<\/a>/);
        assert.match(html, /<strong[^>]*>Y<\/strong>$/);
        assert.ok(!html.includes('data-libraries'));
    });

    it('menu of libraries only if the site has others', () => {
        const z = zenOf(LIB, [OWN]);
        showCrumbs(z, LIB);
        assert.ok(!z.crumbs.innerHTML.includes('data-libraries'), 'no other library');
        z.libraries = [OWN, OTHER];
        showCrumbs(z, LIB);
        assert.match(z.crumbs.innerHTML, /^<strong[^>]*>Documents<\/strong><button[^>]*data-libraries/);
    });
});
