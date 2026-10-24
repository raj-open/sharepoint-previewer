// Opening files (viewer wiring itself: behavioural tests); same file in any spelling of its path
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load } from '../../helpers.mjs';

const { sameFile, viewer } = await load('viewer/open.js');

describe('viewer/open', () => {
  it('no viewer before a file is opened', () => assert.equal(viewer, null));
  it('same file: encoding, case, trailing slash', () => {
    assert.equal(sameFile('/sites/T/Shared%20Documents/A.txt', '/sites/t/shared documents/a.txt/'), true);
    assert.equal(sameFile('/sites/T/a.txt', '/sites/T/b.txt'), false);
  });
});
