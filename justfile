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
PATH_SRC := "src/main.js"
PATH_SRC_3D := "src/viewer-3d/main.js"
PATH_DIST := "dist"
PATH_VERSION := "dist/VERSION"
VERSION := trim(read(PATH_VERSION))
# release folder, flat: userscript, 3D files, NOTES.md
PATH_RELEASE := PATH_DIST / "v" + VERSION
BIOME := "node_modules/.bin/biome"
ESBUILD := "node_modules/.bin/esbuild"
LINT_PATHS := "src tests"

# ----------------------------------------------------------------
# TARGETS - setup
# ----------------------------------------------------------------

# constructs local files (.env, ...) from /templates, without overwriting
[group("setup")]
setup:
    @for path in templates/template-*; do \
        name="$(basename "${path}")"; \
        name="${name#template-}"; \
        if [[ -f "${name}" ]]; then \
            echo "keep ${name}"; \
        else \
            cp "${path}" "${name}"; \
            echo "created ${name}"; \
        fi; \
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

# writes release to /dist/v<VERSION>; stamps @version and 3D hashes into userscript
[group("build")]
build-dist: build-3d
    @hash_js="$(just _sha256 "{{PATH_RELEASE}}/ifc-lite-3d.js")"; \
    hash_wasm="$(just _sha256 "{{PATH_RELEASE}}/ifc-lite_bg.wasm")"; \
    path="{{PATH_RELEASE}}/{{NAME}}.js"; \
    sed -E \
        -e "s|^(// @version[[:space:]]+).*$|\1{{VERSION}}|" \
        -e "s|(const VIEWER_3D_JS_SHA256 = ')[0-9a-f]*'|\1${hash_js}'|" \
        -e "s|(const VIEWER_3D_WASM_SHA256 = ')[0-9a-f]*'|\1${hash_wasm}'|" \
        "{{PATH_SRC}}" > "${path}"; \
    node --check "${path}"
    @cp NOTES.md "{{PATH_RELEASE}}/NOTES.md"
    @echo "built {{PATH_RELEASE}}"

# bundles ifc-lite (pinned in manifest) for the optional 3D view; wasm is copied as is
[group("build")]
build-3d:
    @mkdir -p "{{PATH_RELEASE}}"
    @banner="$(node -p '["geometry", "renderer", "wasm"].map((name) => `@ifc-lite/${name} ${require(`./node_modules/@ifc-lite/${name}/package.json`).version}`).join(", ")')"; \
    "{{ESBUILD}}" "{{PATH_SRC_3D}}" --bundle --minify --format=iife --log-level=warning \
        --banner:js="/* ifc-lite library bundle for Sharepoint Previewer: ${banner} (MPL-2.0, source: https://github.com/LTplus-AG/ifc-lite). Engine binary: ifc-lite_bg.wasm from @ifc-lite/wasm. */" \
        --outfile="{{PATH_RELEASE}}/ifc-lite-3d.js"
    @cp node_modules/@ifc-lite/wasm/pkg/ifc-lite_bg.wasm "{{PATH_RELEASE}}/ifc-lite_bg.wasm"

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

_tests kind:
    @files="$(find "tests/{{kind}}" -type f -name 'tests_*.mjs' | sort)"; \
    if [[ -z "${files}" ]]; then \
        echo "no {{kind}} tests"; \
    else \
        node --test ${files}; \
    fi

# ----------------------------------------------------------------
# TARGETS - quality
# ----------------------------------------------------------------

# formats + lints with auto-fixes; fails only if fixes are impossible
[group("quality")]
prettify:
    @"{{BIOME}}" check --write {{LINT_PATHS}}

# dry run of prettify; fails if prettify would change or fail
[group("quality")]
lint-check:
    @"{{BIOME}}" check {{LINT_PATHS}}

# ----------------------------------------------------------------
# TARGETS - clean
# ----------------------------------------------------------------

[group("clean")]
clean:
    @rm -rf node_modules
    @rm -rf "{{PATH_DIST}}"/v*/
    @find . -name '.DS_Store' -not -path './__human__/*' -delete 2> /dev/null || true
