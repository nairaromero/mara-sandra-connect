#!/bin/bash
# Cloudflare Workers Builds — Version command (runs for non-production branches).
# Production (main) uses the Deploy command (npx wrangler deploy) directly.
#
# Staging branch: patches the Vite-generated wrangler config to deploy as a
# separate worker (mara-sandra-connect-staging) routed to
# staging.marasandraconnect.com. Necessary because the Vite plugin generates
# dist/server/wrangler.json WITHOUT env sections from wrangler.jsonc.
#
# Other branches: upload a preview version (default Workers Builds behavior).

echo "cf-version.sh: WORKERS_CI_BRANCH=$WORKERS_CI_BRANCH"

if [ "$WORKERS_CI_BRANCH" = "staging" ]; then
  echo "cf-version.sh: patching config for staging worker"

  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('dist/server/wrangler.json', 'utf8'));
    cfg.name = 'mara-sandra-connect-staging';
    cfg.routes = [{ pattern: 'staging.marasandraconnect.com/*', zone_name: 'marasandraconnect.com' }];
    fs.writeFileSync('dist/server/wrangler.json', JSON.stringify(cfg, null, 2));
    console.log('Patched:', JSON.stringify({ name: cfg.name, routes: cfg.routes }));
  "

  echo "cf-version.sh: deploying staging worker"
  npx wrangler deploy
else
  echo "cf-version.sh: uploading preview version"
  npx wrangler versions upload
fi
