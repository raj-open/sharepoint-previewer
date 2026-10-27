// Entry of the userscript: modules in load order (they only define), then start-up in one place

// ===========================================================================
// IMPORTS
// ===========================================================================

import './_core/settings.ts';
import './_core/settings-form.ts';
import { registerMenu } from './_core/menu.ts';
import './ui/move.ts';
import './text/lang.ts';
import './ui/icons.ts';
import { injectStyles } from './ui/styles.ts';
import { handleEyes } from './_core/list.ts';
import { watchList } from './_core/list.ts';
import './_core/util.ts';
import './text/highlight/tokenise.ts';
import './text/highlight/json.ts';
import './text/highlight/xml.ts';
import './text/highlight/ifc.ts';
import './text/highlight/yaml.ts';
import './text/highlight/toml.ts';
import './text/highlight/m.ts';
import './text/highlight/js.ts';
import './text/highlight/py.ts';
import './text/highlight/md.ts';
import './text/highlight/rst.ts';
import './text/highlight/csv.ts';
import './text/highlight/xlf.ts';
import './text/highlight/sql.ts';
import './text/highlight/index.ts';
import './text/lint/core.ts';
import './text/lint/json.ts';
import './text/lint/xml.ts';
import './text/lint/yaml.ts';
import './text/lint/ifc.ts';
import './text/lint/m.ts';
import './text/lint/index.ts';
import './view/lines.ts';
import './view/table.ts';
import './viewer/open.ts';
import './viewer/panel.ts';
import './viewer/layout.ts';
import './viewer/status.ts';
import { guardEdits } from './viewer/edit.ts';
import './viewer/names.ts';
import './viewer/view3d.ts';
import './viewer/cache.ts';
import './viewer/messages.ts';
import './text/lint/worker.ts';
import './readers/text.ts';
import './readers/ranges.ts';
import './readers/zip.ts';
import './readers/parquet/meta.ts';
import './readers/codecs/snappy.ts';
import './readers/codecs/lz4.ts';
import './readers/codecs/zstd.ts';
import './readers/parquet/pages.ts';
import './readers/parquet/values.ts';
import './readers/parquet/source.ts';
import './readers/sheets/cells.ts';
import './readers/sheets/xml.ts';
import './readers/sheets/package.ts';
import './readers/sheets/xlsx.ts';
import './readers/sheets/xlsb.ts';
import './readers/sheets/ooxml.ts';
import './readers/sheets/ods.ts';
import './readers/sheets/cfb.ts';
import './readers/sheets/xls.ts';
import './readers/sheets/index.ts';
import './readers/links.ts';
import './readers/search.ts';
import './_core/prefs.ts';
import './viewer/views.ts';

// ===========================================================================
// EXECUTION
// ===========================================================================

registerMenu();
watchList();
handleEyes();
injectStyles();
guardEdits();
