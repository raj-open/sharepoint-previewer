// Java serialisation streams: read in full, as plain values
// Fixture: /tests/mocks/mock-sharepoint/library/Rules/rules.cset (ZIP), its entry written by ObjectOutputStream
// (classes example.rules.*: a rule set with rules, a map, a sorted set, an enum, arrays, custom data, a long text)

import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { fixture } from '../helpers.ts';
import { load } from '../helpers.ts';
import { reader } from '../helpers.ts';

const { readJava, javaPlain, modifiedUtf8, isJava } = await load('readers/java.ts');
const { zipEntries, zipEntryBytes } = await load('readers/zip.ts');

const file = fixture('Rules/rules.cset');
const { read } = reader(file);
const entry = (await zipEntries(read, file.length)).find((e: { name: string }) => e.name.endsWith('.cset'));
const raw: Uint8Array = await zipEntryBytes(read, entry);

describe('readers/java', () => {
    it('stream: magic; all top-level values; objects counted per class', () => {
        assert.ok(isJava(raw) && !isJava(new Uint8Array([0x50, 0x4b, 3, 4])));
        const { roots, classes, strings } = readJava(raw);
        assert.equal(roots.length, 2);
        assert.equal(roots[1], 'second root');
        assert.equal(classes.get('example.rules.Rule'), 2);
        assert.equal(classes.get('java.util.ArrayList'), 1);
        assert.ok(strings.includes('Walls have a fire rating'));
    });

    it('plain values: fields, shadowed fields, primitives, arrays, enums, classes', () => {
        const [set] = javaPlain(readJava(raw).roots);
        assert.equal(set['@class'], 'example.rules.RuleSet');
        const rule = set.first;
        assert.equal(rule['@id'], 1);
        assert.deepEqual([rule.id, rule['Base.id']], [7, 1]); // subclass field keeps the name
        assert.deepEqual(
            [rule.created, rule.enabled, rule.flag, rule.mark, rule.ratio, rule.tolerance, rule.level],
            [1767225600000, true, -1, 'x', 1.5, 0.25, 3],
        );
        assert.deepEqual(rule.limits, [1, 2, 3]);
        assert.deepEqual(rule.tags['@items'], ['walls', 'doors']);
        assert.equal(rule.blob, '<300 bytes>');
        assert.equal(rule.severity, 'Severity.HIGH');
        assert.equal(set.kind, 'class example.rules.Rule');
        assert.equal(set.nothing, null);
        assert.equal(set.longText.length, 70000); // TC_LONGSTRING
    });

    it('plain values: references once in full, then by id; collections and own data', () => {
        const [set] = javaPlain(readJava(raw).roots);
        assert.deepEqual(set.rules['@items'][0], { '@ref': 1 });
        assert.equal(set.rules['@items'][1].title, 'Doors are wide enough');
        assert.deepEqual(set.params['@entries'], [
            { key: 'min width', value: 0.9 },
            { key: 'unit', value: 'm' },
            { key: 'count', value: 3 },
        ]);
        assert.deepEqual(set.scope['@items'], ['IfcDoor', 'IfcWall']); // comparator left out
        assert.deepEqual(set.counter['@data'], ['<00 00 00 2a>', 'extra']); // writeObject
        assert.deepEqual(set.box['@data'], ['<00 05 62 6f 78 65 64>', 'Severity.LOW']); // Externalizable
        assert.equal(set['@items'], undefined); // own classes are no collections, whatever their names
    });

    it('modified UTF-8: NUL as C0 80, characters beyond U+FFFF as surrogates', () => {
        const b = new Uint8Array([0x61, 0xc0, 0x80, 0xc3, 0xbc, 0xed, 0xa0, 0xbe, 0xed, 0xb7, 0xb1]);
        assert.equal(modifiedUtf8(b, 0, b.length), 'a\0ü🧱');
        const [set] = javaPlain(readJava(raw).roots);
        assert.match(set.description, /Wände – mit Ümlauten, \0 NUL und Emoji 🧱$/);
    });

    it('damaged or unknown: refused with the position', () => {
        assert.throws(() => readJava(new Uint8Array([1, 2, 3, 4])), /not a Java serialisation stream/);
        assert.throws(() => readJava(raw.subarray(0, 200)), /stream ends early \(byte \d+\)/);
        assert.throws(() => readJava(new Uint8Array([0xac, 0xed, 0, 5, 0x42])), /unknown tag 0x42 \(byte 4\)/);
        assert.throws(() => readJava(new Uint8Array([0xac, 0xed, 0, 5, 0x7b])), /exception/);
    });
});
