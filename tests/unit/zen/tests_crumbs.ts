// Crumbs of the Zen list: site (once read), library (menu only if the site has others), folders below it
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import type { Fake } from '../helpers.ts';
import { element } from '../helpers.ts';
import { load } from '../helpers.ts';

const { showCrumbs } = await load('zen/crumbs.ts');

const LIB = '/sites/A/Shared Documents';
const SITE = {
    title: 'Team <A>',
    url: '/sites/A/_layouts/15/viewlsts.aspx',
    libraries: [{ title: 'Documents', url: `${LIB}/Forms/AllItems.aspx`, folder: LIB }],
};
const OTHER = { title: 'Reports', url: '/sites/A/Reports/Forms/AllItems.aspx', folder: '/sites/A/Reports' };

const zenOf = (folder: string, site: Fake | null = null): Fake => ({
    crumbs: element(),
    folder,
    site,
    data: { title: 'Documents' },
});

describe('zen/crumbs', () => {
    it('library, then the folders below it (links but the last); no site yet', () => {
        const z = zenOf(`${LIB}/X/Y`);
        showCrumbs(z, LIB);
        const html: string = z.crumbs.innerHTML;
        assert.match(html, /^<a data-folder="\/sites\/A\/Shared Documents"[^>]*>Documents<\/a>/);
        assert.match(html, /<a data-folder="\/sites\/A\/Shared Documents\/X"[^>]*>X<\/a>/);
        assert.match(html, /<strong[^>]*>Y<\/strong>$/);
        assert.ok(!html.includes('tp-zen-site'));
        assert.ok(!html.includes('data-libraries'));
    });

    it('site first (its contents, a link); menu of libraries only if there are others', () => {
        const z = zenOf(LIB, SITE);
        showCrumbs(z, LIB);
        assert.match(
            z.crumbs.innerHTML,
            /^<a class="tp-zen-site" href="\/sites\/A\/_layouts\/15\/viewlsts.aspx"[^>]*>Team &lt;A&gt;/,
        );
        assert.ok(!z.crumbs.innerHTML.includes('data-libraries'), 'no other library');
        z.site = { ...SITE, libraries: [...SITE.libraries, OTHER] };
        showCrumbs(z, LIB);
        assert.match(z.crumbs.innerHTML, /<strong[^>]*>Documents<\/strong><button[^>]*data-libraries/);
    });
});
