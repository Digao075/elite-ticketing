import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const DEDICATED_TEST_DATABASE_URL =
  'postgresql://elite_test:elite_test_password@127.0.0.1:5434/elite_ticketing_test?schema=public';
export const DEDICATED_TEST_TMDB_API_KEY = 'test-only-inert-tmdb-key';
export const DEDICATED_TEST_CONTENT_SELECTION_SECRET = 'test-only-inert-content-selection-secret';

const refusalMessage =
  'Refusing database test access: DATABASE_URL is not the dedicated Docker test database';

function commandRunner({ command, args, env }) {
  return new Promise((resolveCommand) => {
    const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command;
    const child = spawn(executable, args, {
      env,
      shell: process.platform === 'win32' && executable.endsWith('.cmd'),
      stdio: 'inherit',
    });
    let settled = false;

    const finish = (exitCode) => {
      if (!settled) {
        settled = true;
        resolveCommand(exitCode ?? 1);
      }
    };

    child.once('error', () => finish(1));
    child.once('close', finish);
  });
}

export function assertDedicatedTestDatabaseUrl(databaseUrl) {
  try {
    const parsedUrl = new URL(databaseUrl);

    if (parsedUrl.href === DEDICATED_TEST_DATABASE_URL) {
      return parsedUrl;
    }
  } catch {
    // The same refusal applies to an absent or malformed value.
  }

  throw new Error(refusalMessage);
}

export async function runWithDisposableTestDatabase(runCommand = commandRunner) {
  const migrationEnvironment = {
    ...process.env,
    DATABASE_URL: DEDICATED_TEST_DATABASE_URL,
    TMDB_API_KEY: DEDICATED_TEST_TMDB_API_KEY,
  };
  delete migrationEnvironment.CONTENT_SELECTION_SECRET;
  const testEnvironment = {
    ...migrationEnvironment,
    CONTENT_SELECTION_SECRET: DEDICATED_TEST_CONTENT_SELECTION_SECRET,
  };
  let exitCode = 1;

  try {
    const staleCleanupExitCode = await runCommand({
      command: 'docker',
      args: ['compose', 'rm', '-sfv', 'db-test'],
    });
    if (staleCleanupExitCode !== 0) {
      exitCode = staleCleanupExitCode || 1;
    } else {
      const startupExitCode = await runCommand({
        command: 'docker',
        args: ['compose', 'up', '-d', '--wait', 'db-test'],
      });
      if (startupExitCode !== 0) {
        exitCode = startupExitCode || 1;
      } else {
        const migrationExitCode = await runCommand({
          command: 'pnpm',
          args: ['--dir', 'apps/api', 'exec', 'prisma', 'migrate', 'deploy'],
          env: migrationEnvironment,
        });
        if (migrationExitCode !== 0) {
          exitCode = migrationExitCode || 1;
        } else {
          exitCode = await runCommand({
            command: 'pnpm',
            args: ['-r', '--if-present', 'test'],
            env: testEnvironment,
          });
        }
      }
    }
  } catch {
    exitCode = 1;
  } finally {
    try {
      const cleanupExitCode = await runCommand({
        command: 'docker',
        args: ['compose', 'rm', '-sfv', 'db-test'],
      });

      if (cleanupExitCode !== 0) {
        exitCode = cleanupExitCode || 1;
      }
    } catch {
      exitCode = 1;
    }
  }

  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWithDisposableTestDatabase().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
