# Demo: Overview #

All screenshots show the mock Sharepoint of the tests
(`/tests/mocks/mock-sharepoint`),
written by `just demos`.

## List view ##

Each file in the library gets an eye.
One click opens the preview next to the list,
without downloading the file or leaving the page.

![List view with eyes](img/list.png)

## Search results ##

Files found by the library search carry no path in Sharepoint's list.
The previewer looks them up by name below the folder open
and shows them from where they are.

![Search result previewed below the list](img/search.png)

## Layouts ##

The viewer sits below the list (above),
right of the list,
or in a movable pop-up (layout button, top left of the viewer).

![Viewer right of the list](img/vertical.png)

![Viewer as pop-up](img/popup.png)

The pop-up can be resized at its lower right corner (its size is kept, like its position).
A narrow viewer puts the file name on a second row.

![Narrow viewer: title bar on two rows](img/narrow.png)

## Title bar ##

The title bar names the file shown.
(i) shows its properties:
dates, size, format, encoding, delimiter, shape.

![Title bar with properties](img/title.png)

The chain icon copies the file's link,
clean as a person reads it (not encoded, no query),
e.g. `https://acme.sharepoint.com/sites/Test/Mock Data/Data/prices.csv`.
Without a file open, it copies the folder's link.

![Link copied](img/link.png)

In edit mode, a click on the name (or F2) gives the file another name:
the upload then goes to a new file, the original stays as it is.

![File name being changed](img/rename.png)

## Text ##

Plain text files open as text,
with syntax colours and line numbers.

![XML file as text](img/text.png)

## Syntax check ##

Structured files (JSON, XML, YAML, IFC, ...) are checked on opening.
Errors are summarised and marked in the text.

![Broken XML file with errors marked](img/lint.png)

## Markdown ##

Markdown files are rendered;
**Text** shows the source.

![Rendered Markdown file](img/markdown.png)

[Back to the README](../README.md)
