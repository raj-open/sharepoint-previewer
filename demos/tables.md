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

Log files can be shown as a table with guessed fields;
long entries expand in place.

![Log file as table](img/log.png)

[Back to the demos](README.md)
