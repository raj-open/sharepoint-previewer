// Tab "About": name and version, installation, controls; links only if there are any (http(s) only, escaped)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { aboutHtml, aboutLinks, CONTROLS } = await load('_core/about.ts');

const C = { muted: '#666', border: '#ccc' };

describe('about', () => {
    it('name and version (of the running script), installation, controls', () => {
        const html = aboutHtml(C, {});
        assert.match(html, /Sharepoint Previewer vtest/);
        assert.match(html, /Installation/);
        assert.match(html, /sharepoint-previewer\.min\.js/);
        for (const [key] of CONTROLS) assert.ok(html.includes(key.replace(/&/g, '&amp;')), key);
        assert.ok(
            CONTROLS.some(([key]: [string]) => /Delete/.test(key)),
            'delete named',
        );
        assert.ok(
            CONTROLS.some(([key, what]: [string, string]) => /Shift \+ Delete/.test(key) && /purge/.test(what)),
            'purge named',
        );
    });

    it('links: none (empty) -> no section at all; given -> shown, new tab, escaped', () => {
        assert.doesNotMatch(aboutHtml(C, {}), /Links|data-links/);
        const html = aboutHtml(C, { Repository: 'https://example.org/a?b=1&c=2', 'A "B"': 'https://example.org/x' });
        assert.match(html, /data-links/);
        assert.match(
            html,
            /href="https:\/\/example\.org\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">Repository</,
        );
        assert.match(html, />A &quot;B&quot;</);
    });

    it('links: only http(s); no label, no link', () => {
        assert.deepEqual(
            aboutLinks({
                a: 'javascript:alert(1)',
                b: 'ftp://x',
                c: 'https://ok.example',
                '': 'https://x',
                d: 'http://y.example',
            }),
            [
                ['c', 'https://ok.example'],
                ['d', 'http://y.example'],
            ],
        );
        assert.deepEqual(aboutLinks({}), []);
    });

    it('default links: those of ABOUT_LINKS', () => {
        assert.ok(aboutLinks().length >= 1);
    });
});
