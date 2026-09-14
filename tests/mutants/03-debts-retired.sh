#!/usr/bin/env bash
# Sabotagem em transform Vite ou cópia temporária: nunca edita a aplicação.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node tests/verify/debts-mutants.mjs
