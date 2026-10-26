# Demo: Caching #

All screenshots show the mock Sharepoint of the tests
(`/tests/mocks/mock-sharepoint`),
written by `just demos`
(with chunks of 1 KB, so that the small test files are cached in parts;
the default is 512 KB, setting `cache-chunk-bytes`).
Details: [NOTES.md, §7](../NOTES.md#7-caching-logic).

## Logic ##

```mermaid
flowchart TD
    open([eye clicked]) --> kept{in the cache?}
    kept -- yes --> show[shown at once, nothing fetched]
    kept -- no --> room{room in the cache?}
    room -- no --> ask[asks: clear the other files?] --> first
    room -- yes --> first[first chunk fetched<br>HTTP range request]
    first --> shown[shown: eye half open]
    shown --> next[Cache next: one more chunk] --> done{all bytes?}
    shown --> all[Cache all: the rest<br>asks above 16 MB] --> done
    done -- no --> shown
    done -- yes --> full[fully cached: eye open]
    full --> clear[Clear this file / all files<br>or page reload] --> gone[eye closed]
```

- Contents stay in the tab's memory only (nothing on disk), up to 256 MB for all files (setting `memory-cache-bytes`).
- Big Parquet and IFCZIP files (more than one chunk) are fetched only on request.
- A running "Cache all" goes on in the background when another file is shown; the stop button cancels it.

## Partly cached ##

The first chunk is shown at once.
The bar below the text fetches the next chunk;
the button in the header (or the hint in the status bar) fetches the rest.
In the list, the eye is half open (here: `corner.ifc`; `wall.ifc` is fully cached).

![Partly cached file](img/cache-partly.png)

## Fully cached ##

Once every byte is there, the status bar says "fully cached" and the eye is open.
Opening the file again fetches nothing.

![Fully cached file](img/cache-full.png)

[Back to the demos](README.md)
