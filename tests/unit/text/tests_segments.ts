// Message segments: text, JSON and Python-like literals; JSON indented as written
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../helpers.ts';

const { segments, indentJson } = await load('text/segments.ts');

describe('text/segments', () => {
    it('JSON object between text, kept as written (big numbers too)', () =>
        assert.deepEqual(segments('placed {"id": 1, "total": 12345678901234567890} by [main]'), [
            { kind: 'text', text: 'placed ' },
            { kind: 'json', text: '{"id": 1, "total": 12345678901234567890}' },
            { kind: 'text', text: ' by [main]' },
        ]));
    it('JSON over several lines; lists', () => {
        assert.deepEqual(segments('{"a": 1,\n  "b": [2]}'), [{ kind: 'json', text: '{"a": 1,\n  "b": [2]}' }]);
        assert.deepEqual(
            segments('ids [1, 2] end').map((s) => s.kind),
            ['text', 'json', 'text'],
        );
    });
    it('Python literals: quotes, True / None, tuples, trailing commas -> JSON', () =>
        assert.deepEqual(segments("x={'a': 'o\\'neil', 'ok': True, 't': (1, 2,), 'n': None}"), [
            { kind: 'text', text: 'x=' },
            { kind: 'python', text: '{"a":"o\'neil","ok":true,"t":[1,2],"n":null}' },
        ]));
    it('stay text: brackets after a word, invalid objects, empty ones', () => {
        for (const text of ['sshd[123]: started', '[main] {broken: 1}', '{} and []', 'plain'])
            assert.deepEqual(segments(text), [{ kind: 'text', text }]);
    });
    it('indented by 2 spaces; empty objects and lists stay short; strings untouched', () =>
        assert.equal(
            indentJson('{"a":[1,{}],"b":{"c":"x, y: z"},"d":[]}'),
            '{\n  "a": [\n    1,\n    {}\n  ],\n  "b": {\n    "c": "x, y: z"\n  },\n  "d": []\n}',
        ));
});
