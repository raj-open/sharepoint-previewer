# ----------------------------------------------------------------
# Justfile
# Recipes for various workflows.
# cf. https://just.systems/man/en
# ----------------------------------------------------------------

_default:
    @- just --unsorted --list

menu:
    @- just --unsorted --choose

set dotenv-load := true
set positional-arguments := true
set shell := ["bash", "-euo", "pipefail", "-c"]
# NOTE: on Windows requires bash (e.g. Git Bash) on the PATH
set windows-shell := ["bash", "-euo", "pipefail", "-c"]

# --------------------------------
# VARIABLES
# --------------------------------

NAME := env("NAME", "sharepoint-previewer")
# local port of the explorative tests (mock SharePoint)
HTTP_PORT := env("HTTP_PORT", "8080")
# userscript: modules under /src (entry and header in /src/_core); bundled and minified by build-src into /src, both kept in the repo
PATH_MODULES := "src"
PATH_SRC := "src/main.js"
PATH_MIN := "src/main.min.js"
PATH_SRC_3D := "src/@apis/ifc-lite/main.js"
PATH_DIST := "dist"
PATH_VERSION := "dist/VERSION"
VERSION := trim(read(PATH_VERSION))
# release folder, flat: userscript, 3D files, NOTES.md
PATH_RELEASE := PATH_DIST / "v" + VERSION
BIOME := "node_modules/.bin/biome"
ESBUILD := "node_modules/.bin/esbuild"
TSC := "node_modules/.bin/tsc"
# size limits (rule of thumb, cf. /specs.md): userscript source, minified userscript
MAX_KB_SRC := "500"
MAX_KB_MIN := "300"
# lint scope: src + tests + named root files (same as `files.includes` in /biome.json)
LINT_PATHS := "src scripts tests biome.json package.json tsconfig.json"

# ----------------------------------------------------------------
# TARGETS - setup
# ----------------------------------------------------------------

# constructs local files (.env, ...) from /templates, without overwriting
[group("setup")]
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    for path in templates/template-*; do
        name="$(basename "${path}")"
        name="${name#template-}"
        if [[ -f "${name}" ]]; then
            echo "keep ${name}"
        else
            cp "${path}" "${name}"
            echo "created ${name}"
        fi
    done

# ----------------------------------------------------------------
# TARGETS - build
# ----------------------------------------------------------------

# installs dependencies (per lock) and builds the userscript
[group("build")]
build: build-deps build-dist

# installs dependencies per lock; updates lock only if manifest changed
[group("build")]
build-deps:
    @npm ci --no-audit --no-fund || npm install --no-audit --no-fund
    @npx playwright install chromium

# bundles the modules into the userscript (/src/main.js, readable) and minifies it (/src/main.min.js)
[group("build")]
build-src:
    @node scripts/bundle.mjs "{{PATH_MODULES}}/_core/main.js" "{{PATH_MODULES}}/_core/header.js" "{{PATH_MODULES}}/_core/types.js" "{{PATH_SRC}}"
    @node --check "{{PATH_SRC}}"
    @just _minify "{{PATH_SRC}}" "{{PATH_MIN}}"
    @just _size "{{PATH_SRC}}" "{{MAX_KB_SRC}}"
    @just _size "{{PATH_MIN}}" "{{MAX_KB_MIN}}"

# writes release to /dist/v<VERSION>: both userscripts with @version (not the commit tagged v<VERSION>: <VERSION>-beta.<short commit>) and 3D hashes stamped, 3D files, notes
[group("build")]
build-dist: build-src build-3d
    #!/usr/bin/env bash
    set -euo pipefail
    hash_js="$(just _sha256 "{{PATH_RELEASE}}/ifc-lite-3d.js")"
    hash_wasm="$(just _sha256 "{{PATH_RELEASE}}/ifc-lite_bg.wasm")"
    version="{{VERSION}}"
    if git rev-parse --git-dir >/dev/null 2>&1 &&
        [ "$(git tag --points-at HEAD 2>/dev/null | grep -Fx "v{{VERSION}}")" != "v{{VERSION}}" ]; then
        version="{{VERSION}}-beta.$(git rev-parse --short HEAD)"
    fi
    # quoted value: opening quote, then anything up to the closing quote
    quote='"'"'";
    for pair in "{{PATH_SRC}}:{{NAME}}.js" "{{PATH_MIN}}:{{NAME}}.min.js"; do
        path="{{PATH_RELEASE}}/${pair#*:}"
        sed -E \
            -e "s|^(// @version[[:space:]]+).*$|\1${version}|" \
            -e "s|(VIEWER_3D_JS_SHA256[[:space:]]*=[[:space:]]*[${quote}])[^${quote}]*|\1${hash_js}|" \
            -e "s|(VIEWER_3D_WASM_SHA256[[:space:]]*=[[:space:]]*[${quote}])[^${quote}]*|\1${hash_wasm}|" \
            "${pair%%:*}" > "${path}"
        node --check "${path}"
    done
    cp NOTES.md "{{PATH_RELEASE}}/NOTES.md"
    built=$(sed -n 's|^// @version[[:space:]]*||p' "{{PATH_RELEASE}}/{{NAME}}.js")
    echo "built {{PATH_RELEASE}} (${built})"

# minified userscript; its ==UserScript== header is kept as is (Tampermonkey reads it).
# NOTE: names are kept: the check worker is built from the script's own function sources
_minify path_in path_out:
    #!/usr/bin/env bash
    set -euo pipefail
    header=$(sed -n '\|^// ==UserScript==|,\|^// ==/UserScript==|p' "{{path_in}}")
    header+=$'\n// @ts-nocheck: built file'
    "{{ESBUILD}}" "{{path_in}}" --minify-whitespace --minify-syntax --charset=utf8 --legal-comments=none --line-limit=1000 \
        --log-level=warning --banner:js="${header}" --outfile="{{path_out}}"
    node --check "{{path_out}}"

# warns if file is above size limit (KB)
_size path max_kb:
    #!/usr/bin/env bash
    set -euo pipefail
    kb="$(( ( $(wc -c < "{{path}}") + 1023 ) / 1024 ))"
    if (( kb > {{max_kb}} )); then
        echo "warning: {{path}} is ${kb} KB (limit {{max_kb}} KB)"
    else
        echo "size {{path}}: ${kb} KB (limit {{max_kb}} KB)"
    fi

# bundles ifc-lite (pinned in manifest) for the optional 3D view; wasm is copied as is
[group("build")]
build-3d:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{PATH_RELEASE}}"
    banner="$(node -p '["geometry", "renderer", "wasm"].map((name) => `@ifc-lite/${name} ${require(`./node_modules/@ifc-lite/${name}/package.json`).version}`).join(", ")')"
    "{{ESBUILD}}" "{{PATH_SRC_3D}}" --bundle --minify --format=iife --log-level=warning \
        --banner:js="/* ifc-lite library bundle for Sharepoint Previewer: ${banner} (MPL-2.0, source: https://github.com/LTplus-AG/ifc-lite). Engine binary: ifc-lite_bg.wasm from @ifc-lite/wasm. */" \
        --outfile="{{PATH_RELEASE}}/ifc-lite-3d.js"
    cp node_modules/@ifc-lite/wasm/pkg/ifc-lite_bg.wasm "{{PATH_RELEASE}}/ifc-lite_bg.wasm"

_sha256 path:
    @node -e 'const fs = require("fs"); const crypto = require("crypto"); console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "{{path}}"

# ----------------------------------------------------------------
# TARGETS - tests
# ----------------------------------------------------------------

[group("tests")]
tests: tests-unit tests-behave tests-integration

[group("tests")]
tests-unit:
    @just _tests unit

[group("tests")]
tests-behave:
    @just _tests behave

[group("tests")]
tests-integration:
    @just _tests integration

# explorative tests: mock SharePoint + userscript (/src/main.js) on http://localhost:${HTTP_PORT}; library: Mock Data + Data, or folder
[group("tests")]
tests-explore folder="":
    @node tests/explore/server.mjs "{{HTTP_PORT}}" "{{folder}}"

_tests kind:
    #!/usr/bin/env bash
    set -euo pipefail
    files="$(find "tests/{{kind}}" -type f -name 'tests_*.mjs' | sort)"
    if [[ -z "${files}" ]]; then
        echo "no {{kind}} tests"
    else
        node --test ${files}
    fi

# ----------------------------------------------------------------
# TARGETS - quality
# ----------------------------------------------------------------

# auto qa: lint checks + all tests; must pass before merging to staging, versioning up, merging to main
[group("quality")]
qa: build-src lint-check type-check tests

# formats + lints with auto-fixes; fails only if fixes are impossible
[group("quality")]
prettify:
    @"{{BIOME}}" check --write {{LINT_PATHS}}

# prettify dry run: prettify on a copy; fails only if prettify would fail (not on mere formatting changes)
[group("quality")]
lint-check:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp="$(mktemp -d)"
    trap 'rm -rf "${tmp}"' EXIT
    tar -cf - {{LINT_PATHS}} | tar -xf - -C "${tmp}"
    root="${PWD}"
    cd "${tmp}"
    "${root}/{{BIOME}}" check --write --vcs-enabled=false {{LINT_PATHS}}

# type check of the modules (strict; cf. /tsconfig.json), as the editor shows it
[group("quality")]
type-check:
    @"{{TSC}}" -p tsconfig.json

# ----------------------------------------------------------------
# TARGETS - clean
# ----------------------------------------------------------------

[group("clean")]
clean:
    @rm -rf node_modules
    @rm -rf "{{PATH_DIST}}"/v*/
    @find . -name '.DS_Store' -not -path './__human__/*' -delete 2> /dev/null || true
