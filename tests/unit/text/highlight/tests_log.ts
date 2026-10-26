// Highlighter: log (tokens keep the text exactly; classes for its parts)
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { classesOf } from '../../helpers.ts';
import { joined } from '../../helpers.ts';
import { load } from '../../helpers.ts';

const { highlightLog } = await load('text/highlight/log.ts');
const SAMPLE = [
    '2026-10-24 12:34:56,789 [ERROR] Upload failed: url=https://example.org/a status=503',
    'Oct 24 12:35:01 host app[42]: WARNING disk "C:" at 91%',
    '12:35:02.5 INFO started id=3f2504e0-4f89-11d3-9a0c-0305e82c3301 ok=true',
    "[debug] it didn't work",
    'System.IO.IOException: The process cannot access the file',
    '   at Foo.Bar() in C:\\src\\Foo.cs:line 12',
].join('\n');

describe('text/highlight/log', () => {
    const tokens = highlightLog(SAMPLE);
    it('keeps the text exactly', () => assert.equal(joined(tokens), SAMPLE));
    it('empty text', () => assert.equal(joined(highlightLog('')), ''));
    it('levels', () => {
        assert.ok(classesOf(tokens, 'ERROR').includes('lv-err'), 'ERROR');
        assert.ok(classesOf(tokens, 'failed').includes('lv-err'), 'failed');
        assert.ok(classesOf(tokens, 'WARNING').includes('lv-warn'), 'WARNING');
        assert.ok(classesOf(tokens, 'INFO').includes('lv-info'), 'INFO');
        assert.ok(classesOf(tokens, 'debug').includes('lv-debug'), 'debug');
    });
    it('dates, exceptions, frames, values', () => {
        assert.ok(classesOf(tokens, '2026-10-24 12:34:56,789').includes('log-date'), 'ISO date');
        assert.ok(classesOf(tokens, 'Oct 24 12:35:01').includes('log-date'), 'syslog date');
        assert.ok(classesOf(tokens, '12:35:02.5').includes('log-date'), 'time');
        assert.ok(classesOf(tokens, 'System.IO.IOException').includes('lv-err'), 'exception');
        assert.ok(classesOf(tokens, '   at Foo.Bar() in C:\\src\\Foo.cs:line 12').includes('log-frame'), 'frame');
        assert.ok(classesOf(tokens, 'https://example.org/a').includes('log-url'), 'url');
        assert.ok(classesOf(tokens, '3f2504e0-4f89-11d3-9a0c-0305e82c3301').includes('num'), 'GUID');
        assert.ok(classesOf(tokens, '503').includes('num'), 'number');
        assert.ok(classesOf(tokens, 'status').includes('key'), 'key');
        assert.ok(classesOf(tokens, 'true').includes('lit'), 'literal');
        assert.ok(classesOf(tokens, '"C:"').includes('str'), 'string');
    });
    it('apostrophes in words are no strings', () => assert.ok(!classesOf(tokens, "'t work").includes('str')));
});
