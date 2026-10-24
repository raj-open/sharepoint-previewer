// Requests: this SharePoint only; dates from the file's own response
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load, setLocation } from '../helpers.mjs';

const { sameOrigin, responseDates, OUTSIDE } = await load('readers/request.js');
setLocation('https://contoso.sharepoint.com/sites/Test/Shared%20Documents/Forms/AllItems.aspx');

describe('readers/request', () => {
  it('same origin: relative paths and this host only', () => {
    assert.equal(sameOrigin('/sites/Test/a.txt'), true);
    assert.equal(sameOrigin('https://contoso.sharepoint.com/x'), true);
    assert.equal(sameOrigin('https://example.com/x'), false);
    assert.equal(sameOrigin('https://contoso.sharepoint.com.evil.example/x'), false);
    assert.match(OUTSIDE, /outside this SharePoint/);
  });
  it('dates: Last-Modified, else Content-Disposition; in UTC', () => {
    const res = new Response('', { headers: { 'last-modified': 'Thu, 01 Oct 2026 12:00:00 GMT' } });
    assert.equal(responseDates(res, '').modified, '2026-10-01 12:00:00 UTC');
    const cd =
      'attachment; creation-date="Mon, 05 Jan 2026 08:00:00 GMT"; modification-date="Tue, 06 Jan 2026 09:30:00 GMT"';
    assert.deepEqual(responseDates(new Response(''), cd), {
      modified: '2026-01-06 09:30:00 UTC',
      created: '2026-01-05 08:00:00 UTC',
    });
  });
});
