// XML without DOM: tags, attributes, text, entities, CDATA
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { load } from '../../helpers.ts';

const { scanXml, xmlAttrs, xmlText, ooxmlText, xmlString } = await load('readers/sheets/xml.ts');

describe('readers/sheets/xml', () => {
    it('tags without prefix, empty tags open and close, text between', () => {
        const events: string[] = [];
        scanXml(
            '<?xml version="1.0"?><!-- c > d --><x:a k="1"><b/>t &amp; u<![CDATA[<raw>]]></x:a>',
            (n) => events.push(`<${n}`),
            (n) => events.push(`>${n}`),
            (raw) => events.push(xmlText(raw)),
        );
        assert.deepEqual(events, ['<a', '<b', '>b', 't & u', '<raw>', '>a']);
    });
    it('attributes: prefixes dropped, entities decoded, both quotes', () => {
        assert.deepEqual(xmlAttrs(` r:id="rId1" name='a &lt; b' x="&#x41;&#66;"`), {
            id: 'rId1',
            name: 'a < b',
            x: 'AB',
        });
    });
    it('line ends as XML reads them; OOXML escapes', () => {
        assert.equal(xmlText('a\r\nb\rc'), 'a\nb\nc');
        assert.equal(ooxmlText('A_x000D_B'), 'A\rB');
    });
    it('encoding from BOM', () => {
        assert.equal(xmlString(new Uint8Array([0xff, 0xfe, 0x3c, 0])), '<');
        assert.equal(xmlString(new TextEncoder().encode('﻿<a/>')), '<a/>');
    });
});
