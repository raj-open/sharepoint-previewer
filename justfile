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
PATH_DIST := "dist"
PATH_VERSION := "dist/VERSION"
BIOME := "node_modules/.bin/biome"
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

# writes userscript with @version from /dist/VERSION
[group("build")]
build-dist:
    @version="$(tr -d '[:space:]' < "{{PATH_VERSION}}")"; \
    path="{{PATH_DIST}}/{{NAME}}.user.js"; \
    sed -E "s|^(// @version[[:space:]]+).*$|\1${version}|" "{{PATH_SRC}}" > "${path}"; \
    node --check "${path}"; \
    echo "built ${path} (v${version})"

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
    @rm -f "{{PATH_DIST}}"/*.user.js
    @find . -name '.DS_Store' -not -path './__human__/*' -delete 2> /dev/null || true
