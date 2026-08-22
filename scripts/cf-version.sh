#!/bin/bash
# Cloudflare Workers Builds — version/deploy command.
# Production (main) uses the Deploy command (npx wrangler deploy) — this script
# is NOT called for main.
#
# For the staging branch: full deploy to the staging environment, which routes
# to staging.marasandraconnect.com via wrangler.jsonc env.staging.
#
# For any other branch: upload a preview version (the default behavior).

if [ "$WORKERS_CI_BRANCH" = "staging" ]; then
  npx wrangler deploy --env staging
else
  npx wrangler versions upload
fi
