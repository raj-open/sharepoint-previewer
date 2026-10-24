// Movable windows: remembered offset, kept on screen
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { element, gm, load } from '../../helpers.mjs';

const { placeMoved } = await load('ui/move.js');

describe('ui/move', () => {
  const box = () => {
    const el = element();
    el.isConnected = true;
    el.getBoundingClientRect = () => ({ left: 100, top: 100, width: 400, height: 300, right: 500, bottom: 400 });
    return el;
  };
  it('remembered offset applied', () => {
    gm.local.set('pos', JSON.stringify({ x: 20, y: 30 }));
    const el = box();
    placeMoved(el, 'pos');
    assert.equal(el.style.translate, '20px 30px');
  });
  it('offset that would leave the screen is clamped', () => {
    gm.local.set('pos', JSON.stringify({ x: 99999, y: -99999 }));
    const el = box();
    placeMoved(el, 'pos');
    assert.equal(el.style.translate, `${innerWidth - 80 - 100}px -100px`);
  });
  it('nothing remembered: no offset', () => {
    gm.local.delete('pos');
    const el = box();
    placeMoved(el, 'pos');
    assert.equal(el.style.translate, '0px 0px');
  });
});
