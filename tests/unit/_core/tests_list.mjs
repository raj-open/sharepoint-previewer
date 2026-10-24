// List view: folder of the open view comes from the URL only
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { load, setLocation } from '../helpers.mjs';

const { currentFolder } = await load('_core/list.js');

describe('list', () => {
  it('library root from the list page path', () => {
    setLocation('/sites/Test/Shared%20Documents/Forms/AllItems.aspx');
    assert.equal(currentFolder(), '/sites/Test/Shared Documents');
  });
  it('sub-folder from the id parameter', () => {
    setLocation('/sites/Test/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FTest%2FShared%20Documents%2FData%2F');
    assert.equal(currentFolder(), '/sites/Test/Shared Documents/Data');
  });
  it("SharePoint's own preview: parent folder", () => {
    setLocation('/sites/Test/Shared%20Documents/Forms/AllItems.aspx?id=%2Fx%2Ff.pdf&parent=%2Fsites%2FTest%2FDocs');
    assert.equal(currentFolder(), '/sites/Test/Docs');
  });
  it('outside a library: none', () => {
    setLocation('/sites/Test/SitePages/Home.aspx');
    assert.equal(currentFolder(), null);
  });
});
