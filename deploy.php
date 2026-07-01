<?php

namespace Deployer;

require 'recipe/common.php';

set('application', 'code-line-analysis');
set('keep_releases', 5);
set('git_tty', false);
set('workspace_root', __DIR__);
set('public_dir', 'dist/renderer');
set('verify_base_url', getenv('VERIFY_BASE_URL') ?: 'https://code-line.dogeow.com');

localhost('production')->set('deploy_path', getenv('DEPLOY_PATH') ?: '/var/www/code-line-analysis');

task('deploy:update_code', function () {
    $workspaceRoot = rtrim(get('workspace_root'), '/');
    run('mkdir -p {{release_path}}');
    run('rsync -a --exclude=.git --exclude=node_modules --exclude=dist --exclude=dist-web --exclude=out --exclude=release --exclude=.next --exclude=coverage --exclude=test-results --exclude=playwright-report ' . $workspaceRoot . '/ {{release_path}}/');
});

task('deploy:runtime_files', function () {
    run(<<<'BASH'
bash -lc '
set -euo pipefail
mkdir -p "{{deploy_path}}/shared"
for file in .env .env.local .env.production .env.production.local .npmrc; do
  if [ -f "{{deploy_path}}/$file" ]; then
    cp "{{deploy_path}}/$file" "{{release_path}}/$file"
  fi
done
'
BASH);
});

task('deploy:vendors', function () {
    if (file_exists(get('workspace_root') . '/package-lock.json')) {
        run('cd {{release_path}} && npm ci --ignore-scripts');
    } else {
        writeln('No npm dependency step required.');
    }
});

task('deploy:build', function () {
    run('cd {{release_path}} && npm run build:web');
});

task('deploy:healthcheck', function () {
    run(<<<'BASH'
bash -lc '
set -euo pipefail
if [ -n "{{verify_base_url}}" ]; then
  curl -fsS -o /dev/null -w "public HTTP=%{http_code}\n" "{{verify_base_url}}/"
fi
'
BASH);
});

task('deploy', [
    'deploy:info', 'deploy:setup', 'deploy:lock', 'deploy:release',
    'deploy:update_code', 'deploy:runtime_files', 'deploy:vendors', 'deploy:build',
    'deploy:symlink', 'deploy:healthcheck', 'deploy:unlock', 'deploy:cleanup', 'deploy:success',
]);

after('deploy:failed', 'deploy:unlock');
