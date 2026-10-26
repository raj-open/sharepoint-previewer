# Demos #

What the Sharepoint Previewer looks like and how it behaves,
page by page with screenshots.

In short:
an eye next to each file and folder in a Sharepoint library
opens a viewer beside the list,
without downloading the file or leaving the page.
Text files show with syntax colours and checks,
tables, spreadsheets, Markdown and IFC models get their own views,
and text files can be edited and uploaded again.

All screenshots show the mock Sharepoint of the tests
(`/tests/mocks/mock-sharepoint`, made-up files and people),
written by `just demos` (cf. `/scripts/demos.ts`).
Technical descriptions: [NOTES.md](../NOTES.md)
(how the parts communicate: [§3](../NOTES.md#3-architecture)).

## Pages ##

| Page | Shows |
| :--- | :---- |
| [List view and search](list.md) | eyes on files and folders, search results |
| [Layouts and dark mode](layouts.md) | below or right of the list, pop-up (resizable), narrow viewer, dark mode |
| [Title bar](title-bar.md) | properties, link, another name |
| [Text, checks and Markdown](text.md) | syntax colours, syntax checks, rendered Markdown |
| [Tables and spreadsheets](tables.md) | CSV (colours, editing), Excel tables and sheets, logs |
| [3D](3d.md) | IFC models |
| [Editing](editing.md) | edit, save, upload, cancel (with the logic) |
| [Caching](caching.md) | partly and fully cached files (with the logic) |
| [Settings](settings.md) | form and JSON |

[Back to the README](../README.md)
