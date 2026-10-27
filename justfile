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
# local port of the explorative tests (mock Sharepoint)
HTTP_PORT := env("HTTP_PORT", "8080")
# userscript: TypeScript modules under /src (entry, header);
# bundled by build-src into /dist/userscript.js + minified (local only, version and 3D hashes as dummies)
PATH_MODULES := "src"
PATH_ENTRY := PATH_MODULES / "main.ts"
PATH_HEADER := PATH_MODULES / "_core/header.ts"
PATH_SRC_3D := "src/@apis/ifc-lite/main.ts"
PATH_DIST := "dist"
PATH_BUNDLE := PATH_DIST / "userscript.js"
PATH_BUNDLE_MIN := PATH_DIST / "userscript.min.js"
PATH_VERSION := "dist/VERSION"
VERSION := trim(read(PATH_VERSION))
# release tag: short pre-release forms in /dist/VERSION (1.1.0a1, 1.1.0b2, 1.1.0rc1), long in tags (v1.1.0-alpha.1, ...)
TAG := "v" + replace_regex(replace_regex(replace_regex(VERSION, '([0-9])a([0-9]+)$', '${1}-alpha.${2}'), '([0-9])b([0-9]+)$', '${1}-beta.${2}'), '([0-9])rc([0-9]+)$', '${1}-rc.${2}')
# version of a build (@version of the userscript): VERSION on the commit tagged TAG, else VERSION-beta.<short commit>
BUILD_VERSION := shell('if git rev-parse --git-dir >/dev/null 2>&1 && ! git tag --points-at HEAD 2>/dev/null | grep -qFx "$1"; then echo "$2-beta.$(git rev-parse --short HEAD)"; else echo "$2"; fi', TAG, VERSION)
# release folder, flat: userscript, 3D files, NOTES.md; named after the version of the build
PATH_RELEASE := PATH_DIST / "v" + BUILD_VERSION
# 3D files (ifc-lite) in the release folder: true (default) or false (cf. .env);
# if false, they are built in a temporary folder only, for their hashes in the userscript
BUILD_3D := env("BUILD_3D", "true")
BIOME := "node_modules/.bin/biome"
ESBUILD := "node_modules/.bin/esbuild"
TSC := "node_modules/.bin/tsc"
# size limits (rule of thumb, cf. /specs.md): userscript source, minified userscript
MAX_KB_SRC := "750"
MAX_KB_MIN := "400"
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

# installs dependencies per lock; updates lock only if dependencies in manifest changed (version: cf. build-lock);
# browser for the behavioural tests: Playwright's Chromium, unless BROWSER_CHANNEL names one installed (e.g. chrome)
[group("build")]
build-deps:
    #!/usr/bin/env bash
    set -euo pipefail
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund
    if [[ -z "${BROWSER_CHANNEL:-}" ]]; then
        npx playwright install chromium
    else
        echo "browser: ${BROWSER_CHANNEL} (installed; none downloaded)"
    fi

# writes /dist/VERSION (as semver, cf. TAG) into manifest + lock, then updates lock per manifest; installs nothing
[group("build")]
build-lock:
    @npm version "{{trim_start_match(TAG, "v")}}" --no-git-tag-version --allow-same-version > /dev/null
    @npm install --package-lock-only --no-audit --no-fund

# bundles the modules into the userscript (/dist/userscript.js, readable; types removed) + minified (/dist/userscript.min.js); local only, version and 3D hashes as dummies
[group("build")]
build-src:
    #!/usr/bin/env bash
    set -euo pipefail
    node --disable-warning=ExperimentalWarning scripts/bundle.ts "{{PATH_ENTRY}}" "{{PATH_HEADER}}" "{{PATH_BUNDLE}}"
    node --check "{{PATH_BUNDLE}}"
    just _size "{{PATH_BUNDLE}}" "{{MAX_KB_SRC}}"
    just _minify "{{PATH_BUNDLE}}" "{{PATH_BUNDLE_MIN}}"
    just _size "{{PATH_BUNDLE_MIN}}" "{{MAX_KB_MIN}}"

# writes release to /dist/v<BUILD_VERSION>: userscript with @version (BUILD_VERSION: <VERSION>, off the release tag <VERSION>-beta.<short commit>) and 3D hashes stamped, minified, 3D files (unless BUILD_3D=false), notes
[group("build")]
build-dist: build-src
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{PATH_RELEASE}}"
    # 3D files: in the release folder, or only in a temporary folder (for the hashes)
    case "{{BUILD_3D}}" in
        true)
            path_3d="{{PATH_RELEASE}}"
            ;;

        false)
            path_3d="$(mktemp -d)"
            trap 'rm -rf "${path_3d}"' EXIT
            rm -f "{{PATH_RELEASE}}/ifc-lite-3d.js" "{{PATH_RELEASE}}/ifc-lite_bg.wasm"
            ;;

        *)
            echo "error: BUILD_3D must be true or false (is: {{BUILD_3D}})"
            exit 1
            ;;
    esac
    just build-3d "${path_3d}"
    hash_js="$(just _sha256 "${path_3d}/ifc-lite-3d.js")"
    hash_wasm="$(just _sha256 "${path_3d}/ifc-lite_bg.wasm")"
    version="{{BUILD_VERSION}}"
    # quoted value: opening quote, then anything up to the closing quote
    quote='"'"'";
    path="{{PATH_RELEASE}}/{{NAME}}.js"
    sed -E \
        -e "s|^(// @version[[:space:]]+).*$|\1${version}|" \
        -e "s|(VIEWER_3D_JS_SHA256[[:space:]]*=[[:space:]]*[${quote}])[^${quote}]*|\1${hash_js}|" \
        -e "s|(VIEWER_3D_WASM_SHA256[[:space:]]*=[[:space:]]*[${quote}])[^${quote}]*|\1${hash_wasm}|" \
        -e "/^\/\/ Version and 3D checksums are dummies here/d" \
        "{{PATH_BUNDLE}}" > "${path}"
    node --check "${path}"
    just _minify "${path}" "{{PATH_RELEASE}}/{{NAME}}.min.js"
    just _size "{{PATH_RELEASE}}/{{NAME}}.min.js" "{{MAX_KB_MIN}}"
    cp NOTES.md "{{PATH_RELEASE}}/NOTES.md"
    built=$(sed -n 's|^// @version[[:space:]]*||p' "{{PATH_RELEASE}}/{{NAME}}.js")
    echo "built {{PATH_RELEASE}} (${built}; 3D files: {{BUILD_3D}})"

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

# bundles ifc-lite (pinned in manifest) for the optional 3D view into a folder (default: release folder); wasm is copied as is
[group("build")]
build-3d path=PATH_RELEASE:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{path}}"
    banner="$(node -p '["geometry", "renderer", "wasm"].map((name) => `@ifc-lite/${name} ${require(`./node_modules/@ifc-lite/${name}/package.json`).version}`).join(", ")')"
    "{{ESBUILD}}" "{{PATH_SRC_3D}}" --bundle --minify --format=iife --log-level=warning \
        --banner:js="/* ifc-lite library bundle for Sharepoint Previewer: ${banner} (MPL-2.0, source: https://github.com/LTplus-AG/ifc-lite). Engine binary: ifc-lite_bg.wasm from @ifc-lite/wasm. */" \
        --outfile="{{path}}/ifc-lite-3d.js"
    cp node_modules/@ifc-lite/wasm/pkg/ifc-lite_bg.wasm "{{path}}/ifc-lite_bg.wasm"

# prints the release tag of /dist/VERSION (cf. TAG)
[group("build")]
tag:
    @echo "{{TAG}}"

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

# explorative tests: mock Sharepoint + userscript (/dist/userscript.js) on http://localhost:${HTTP_PORT}; libraries: Mock Library (tests), Mock Tools Library (3D files), Local Library (/data, or folder)
[group("tests")]
tests-explore folder="":
    @node tests/explore/server.ts "{{HTTP_PORT}}" "{{folder}}"

# screenshots for /demos (/demos/img/<case>.png) on the mock Sharepoint; no case: all (cf. /scripts/demos.ts)
[group("tests")]
demos *cases:
    @node scripts/demos.ts "$@"

_tests kind:
    #!/usr/bin/env bash
    set -euo pipefail
    files="$(find "tests/{{kind}}" -type f -name 'tests_*.ts' | sort)"
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

# type check (strict) of the modules, tests and scripts (cf. /tsconfig.json, /tests/tsconfig.json, /scripts/tsconfig.json)
[group("quality")]
type-check:
    @"{{TSC}}" -p tsconfig.json
    @"{{TSC}}" -p tests/tsconfig.json
    @"{{TSC}}" -p scripts/tsconfig.json

# ----------------------------------------------------------------
# TARGETS - clean
# ----------------------------------------------------------------

[group("clean")]
clean:
    @rm -rf node_modules
    @rm -rf "{{PATH_DIST}}"/v*/
    @rm -f "{{PATH_BUNDLE}}" "{{PATH_BUNDLE_MIN}}"
    @rm -rf tests/mocks/mock-sharepoint/__uploads__
    @find . -name '.DS_Store' -not -path './__human__/*' -delete 2> /dev/null || true
