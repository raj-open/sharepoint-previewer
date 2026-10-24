// Entry of the userscript: modules in load order (they only define), then start-up in one place

// ===========================================================================
// IMPORTS
// ===========================================================================

import './settings.js';
import { registerMenu } from './settings-form.js';
import '../ui/move.js';
import '../text/lang.js';
import '../ui/icons.js';
import { injectStyles } from '../ui/styles.js';
import { handleEyes } from './list.js';
import { watchList } from './list.js';
import './util.js';
import '../text/highlight/tokenise.js';
import '../text/highlight/json.js';
import '../text/highlight/xml.js';
import '../text/highlight/ifc.js';
import '../text/highlight/yaml.js';
import '../text/highlight/toml.js';
import '../text/highlight/m.js';
import '../text/highlight/js.js';
import '../text/highlight/py.js';
import '../text/highlight/md.js';
import '../text/highlight/rst.js';
import '../text/highlight/csv.js';
import '../text/highlight/xlf.js';
import '../text/highlight/sql.js';
import '../text/highlight/index.js';
import '../text/lint/core.js';
import '../text/lint/json.js';
import '../text/lint/xml.js';
import '../text/lint/yaml.js';
import '../text/lint/ifc.js';
import '../text/lint/m.js';
import '../text/lint/index.js';
import '../view/lines.js';
import '../view/table.js';
import '../viewer/open.js';
import '../viewer/panel.js';
import '../viewer/layout.js';
import '../viewer/status.js';
import { guardEdits } from '../viewer/edit.js';
import '../viewer/view3d.js';
import '../viewer/cache.js';
import '../viewer/messages.js';
import '../text/lint/worker.js';
import '../readers/text.js';
import '../readers/ranges.js';
import '../readers/zip.js';
import '../readers/parquet/meta.js';
import '../readers/codecs/snappy.js';
import '../readers/codecs/lz4.js';
import '../readers/codecs/zstd.js';
import '../readers/parquet/pages.js';
import '../readers/parquet/values.js';
import '../readers/parquet/source.js';
import '../readers/sheets/cells.js';
import '../readers/sheets/xml.js';
import '../readers/sheets/package.js';
import '../readers/sheets/xlsx.js';
import '../readers/sheets/xlsb.js';
import '../readers/sheets/ooxml.js';
import '../readers/sheets/ods.js';
import '../readers/sheets/cfb.js';
import '../readers/sheets/xls.js';
import '../readers/sheets/index.js';
import '../readers/links.js';
import './prefs.js';
import '../viewer/views.js';

// ===========================================================================
// START-UP
// ===========================================================================

registerMenu();
watchList();
handleEyes();
injectStyles();
guardEdits();
