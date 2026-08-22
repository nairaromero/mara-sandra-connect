#!/bin/bash
# Cloudflare Workers Builds — Version command (runs for non-production branches).
# Production (main) uses the Deploy command (npx wrangler deploy) directly.
#
# NEVER use `wrangler deploy` here — the build token is scoped to the production
# worker (mara-sandra-connect) and would overwrite production. Staging gets its
# own deployment via a separate Workers Builds project (mara-sandra-connect-staging).

echo "cf-version.sh: WORKERS_CI_BRANCH=$WORKERS_CI_BRANCH"
echo "cf-version.sh: uploading preview version"
npx wrangler versions upload
