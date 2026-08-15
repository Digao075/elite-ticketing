import { describe, expect, it } from 'vitest';

const dedicatedDatabaseUrl =
  'postgresql://elite_test:elite_test_password@127.0.0.1:5434/elite_ticketing_test?schema=public';
const refusalMessage =
  'Refusing database test access: DATABASE_URL is not the dedicated Docker test database';

type CommandInvocation = {
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
};

type CommandRunner = (invocation: CommandInvocation) => Promise<number>;

type TestDatabaseRunnerModule = {
  DEDICATED_TEST_DATABASE_URL: string;
  DEDICATED_TEST_TMDB_API_KEY: 'test-only-inert-tmdb-key';
  assertDedicatedTestDatabaseUrl(databaseUrl: string | undefined): URL;
  runWithDisposableTestDatabase(runCommand?: CommandRunner): Promise<number>;
};

async function loadTestDatabaseRunner(): Promise<TestDatabaseRunnerModule> {
  return import(new URL('../../../scripts/run-tests.mjs', import.meta.url).href) as Promise<TestDatabaseRunnerModule>;
}

function recordingCommandRunner(outcomes: Array<number | Error>): {
  invocations: CommandInvocation[];
  runCommand: CommandRunner;
} {
  const invocations: CommandInvocation[] = [];

  return {
    invocations,
    runCommand: async (invocation) => {
      invocations.push(invocation);
      const outcome = outcomes.shift() ?? 0;

      if (outcome instanceof Error) {
        throw outcome;
      }

      return outcome;
    },
  };
}

function expectDedicatedCleanup(invocation: CommandInvocation): void {
  expect(invocation).toMatchObject({
    command: 'docker',
    args: ['compose', 'rm', '-sfv', 'db-test'],
  });
}

describe('disposable PostgreSQL test database runner', () => {
  it('AC-1 exposes the exact dedicated database URL without starting the lifecycle on import', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();

    expect(testDatabaseRunner.DEDICATED_TEST_DATABASE_URL).toBe(dedicatedDatabaseUrl);
  });

  it.each([undefined, '', 'ambient-real-tmdb-key'])(
    'AC-1 injects the inert TMDb key into workspace tests when the parent value is %j without changing the parent',
    async (ambientTmdbApiKey) => {
      const previousTmdbApiKey = process.env.TMDB_API_KEY;
      const testDatabaseRunner = await loadTestDatabaseRunner();
      const { invocations, runCommand } = recordingCommandRunner([0, 0, 0, 0, 0]);

      if (ambientTmdbApiKey === undefined) {
        delete process.env.TMDB_API_KEY;
      } else {
        process.env.TMDB_API_KEY = ambientTmdbApiKey;
      }

      try {
        expect(testDatabaseRunner.DEDICATED_TEST_TMDB_API_KEY).toBe('test-only-inert-tmdb-key');

        await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.toBe(0);

        const workspaceTests = invocations.find(
          ({ command, args }) => command === 'pnpm' && args.join(' ') === '-r --if-present test',
        );
        expect(workspaceTests?.env?.TMDB_API_KEY).toBe(testDatabaseRunner.DEDICATED_TEST_TMDB_API_KEY);
        expect(process.env.TMDB_API_KEY).toBe(ambientTmdbApiKey);
      } finally {
        if (previousTmdbApiKey === undefined) {
          delete process.env.TMDB_API_KEY;
        } else {
          process.env.TMDB_API_KEY = previousTmdbApiKey;
        }
      }
    },
  );

  it('AC-1 runs stale cleanup, health-checked startup, migration, workspace tests, and final cleanup with the dedicated URL', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, 0, 0, 0, 0]);

    await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.toBe(0);

    expect(invocations).toHaveLength(5);
    expectDedicatedCleanup(invocations[0]);
    expect(invocations[1]).toMatchObject({
      command: 'docker',
      args: ['compose', 'up', '-d', '--wait', 'db-test'],
    });
    expect(invocations[2].env?.DATABASE_URL).toBe(dedicatedDatabaseUrl);
    expect(invocations[3]).toMatchObject({
      command: 'pnpm',
      args: ['-r', '--if-present', 'test'],
      env: expect.objectContaining({ DATABASE_URL: dedicatedDatabaseUrl }),
    });
    expectDedicatedCleanup(invocations[4]);
  });

  it.each([
    ['a different protocol', 'mysql://elite_test:elite_test_password@127.0.0.1:5434/elite_ticketing_test?schema=public'],
    ['a different username', 'postgresql://other:elite_test_password@127.0.0.1:5434/elite_ticketing_test?schema=public'],
    ['a different password', 'postgresql://elite_test:other@127.0.0.1:5434/elite_ticketing_test?schema=public'],
    ['a different hostname', 'postgresql://elite_test:elite_test_password@localhost:5434/elite_ticketing_test?schema=public'],
    ['a different port', 'postgresql://elite_test:elite_test_password@127.0.0.1:5435/elite_ticketing_test?schema=public'],
    ['a different database name', 'postgresql://elite_test:elite_test_password@127.0.0.1:5434/another_database?schema=public'],
    ['a different schema', 'postgresql://elite_test:elite_test_password@127.0.0.1:5434/elite_ticketing_test?schema=private'],
  ])('AC-3 refuses %s', async (_description, databaseUrl) => {
    const testDatabaseRunner = await loadTestDatabaseRunner();

    expect(() => testDatabaseRunner.assertDedicatedTestDatabaseUrl(databaseUrl)).toThrowError(
      new Error(refusalMessage),
    );
  });

  it('AC-3 refuses an absent database URL and accepts only the dedicated URL', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();

    expect(() => testDatabaseRunner.assertDedicatedTestDatabaseUrl(undefined)).toThrowError(new Error(refusalMessage));
    expect(testDatabaseRunner.assertDedicatedTestDatabaseUrl(dedicatedDatabaseUrl).href).toBe(dedicatedDatabaseUrl);
  });

  it('AC-2 cleans up db-test and does not continue after Docker startup returns a failure status', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, 17, 0]);

    await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.not.toBe(0);

    expect(invocations).toHaveLength(3);
    expectDedicatedCleanup(invocations[0]);
    expect(invocations[1]).toMatchObject({
      command: 'docker',
      args: ['compose', 'up', '-d', '--wait', 'db-test'],
    });
    expectDedicatedCleanup(invocations[2]);
  });

  it('AC-2 cleans up db-test after Docker startup throws', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, new Error('Docker unavailable'), 0]);

    await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.not.toBe(0);

    expect(invocations).toHaveLength(3);
    expectDedicatedCleanup(invocations[0]);
    expectDedicatedCleanup(invocations[2]);
  });

  it('AC-2 skips workspace tests and cleans up db-test after migration failure', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, 0, 23, 0]);

    await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.not.toBe(0);

    expect(invocations).toHaveLength(4);
    expectDedicatedCleanup(invocations[0]);
    expectDedicatedCleanup(invocations[3]);
    expect(invocations.some((invocation) => invocation.command === 'pnpm' && invocation.args.join(' ') === '-r --if-present test')).toBe(false);
  });

  it('AC-2 skips workspace tests and cleans up db-test after migration throws', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, 0, new Error('Migration failed'), 0]);

    await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.not.toBe(0);

    expect(invocations).toHaveLength(4);
    expectDedicatedCleanup(invocations[0]);
    expectDedicatedCleanup(invocations[3]);
    expect(invocations.some((invocation) => invocation.command === 'pnpm' && invocation.args.join(' ') === '-r --if-present test')).toBe(false);
  });

  it('AC-2 preserves the workspace failure status and still cleans up db-test', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, 0, 0, 41, 0]);

    await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.toBe(41);

    expect(invocations).toHaveLength(5);
    expectDedicatedCleanup(invocations[4]);
  });

  it('AC-2 cleans up db-test when workspace tests throw', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, 0, 0, new Error('Workspace failed'), 0]);

    await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.not.toBe(0);

    expect(invocations).toHaveLength(5);
    expect(invocations[3]).toMatchObject({
      command: 'pnpm',
      args: ['-r', '--if-present', 'test'],
    });
    expectDedicatedCleanup(invocations[4]);
  });

  it('AC-2 fails the lifecycle when final db-test cleanup fails after otherwise passing tests', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, 0, 0, 0, 29]);

    await expect(testDatabaseRunner.runWithDisposableTestDatabase(runCommand)).resolves.not.toBe(0);

    expect(invocations).toHaveLength(5);
    expectDedicatedCleanup(invocations[4]);
  });

  it('AC-2 targets only the db-test Compose service for every Compose lifecycle operation', async () => {
    const testDatabaseRunner = await loadTestDatabaseRunner();
    const { invocations, runCommand } = recordingCommandRunner([0, 0, 0, 0, 0]);

    await testDatabaseRunner.runWithDisposableTestDatabase(runCommand);

    const composeOperations = invocations.filter(({ command, args }) => command === 'docker' && args[0] === 'compose');
    expect(composeOperations).toHaveLength(3);
    expect(composeOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ args: ['compose', 'rm', '-sfv', 'db-test'] }),
        expect.objectContaining({ args: ['compose', 'up', '-d', '--wait', 'db-test'] }),
      ]),
    );
    expect(composeOperations.every(({ args }) => args.at(-1) === 'db-test')).toBe(true);
  });
});
