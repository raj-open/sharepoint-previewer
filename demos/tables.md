# Demo: Tables and spreadsheets #

All screenshots show the mock Sharepoint of the tests
(`/tests/mocks/mock-sharepoint`),
written by `just demos`.

## CSV ##

CSV and Parquet files open as a table.

![CSV file as table](img/csv.png)

Column colours are optional (⋯ → Syntax colours, or the setting `colours-table`).

![CSV file as table, columns coloured](img/csv-colours.png)

In edit mode, cells are edited in place (the cell being edited is framed);
delimiter and quote style can be changed for the whole file.

![CSV file edited in the table](img/csv-edit.png)

## Spreadsheets ##

Excel (`.xlsx`, `.xlsb`, `.xls`) and OpenDocument (`.ods`) spreadsheets
open sheet by sheet or table by table.

![Excel table in the table view](img/spreadsheet.png)

The picker next to **Table** lists all sheets and tables of the file.

![Picker with sheets and tables](img/picker.png)

## Logs (experimental) ##

Log files open as text, with colours for times, levels, names and values.

![Log file as text, coloured](img/log-text.png)

**Table** (experimental) guesses the fields from the start of the lines
(time, context, level, name) and shows one row per entry, the message last.
Entries with more in them (a stack trace, a JSON object, a Python dict) have ▸ in their row number.

![Log file as table](img/log.png)

▸ expands the entry in place:
its message split into text and objects, these indented and coloured
(▸ above the row numbers expands all rows shown).

![Log entry expanded: JSON object indented](img/log-expand.png)

[Back to the demos](README.md)
