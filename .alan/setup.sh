#!/usr/bin/env bash
# Install the pnpm toolchain and dependencies for Tab Tree.
# Runs once per image build, in a clean builder with no Docker daemon.
set -euo pipefail

corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@10.28.2 --activate >/dev/null 2>&1 || true

pnpm install --frozen-lockfile
