#!/usr/bin/env bash
# Vercel ignoreCommand: exit 0 = skip build, exit 1 = run build.
ref="${VERCEL_GIT_COMMIT_REF:-}"
if [[ "$ref" == "main" || "$ref" == "master" || "$ref" == qa/* ]]; then
  exit 1
fi
exit 0
