import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Reachability guard for the notification scheduler (#802).
 *
 * `SchedulerService.initialize()` is what registers the notification schedules
 * and starts the `setInterval` that runs them. It had no caller anywhere in the
 * repo, so none of its tasks ever ran — a reachability defect with no error and
 * no crash. This guard reads the API bootstrap and fails if the notification
 * scheduler is not started on startup and stopped on shutdown, so the wiring
 * cannot silently disappear again.
 *
 * Why a static read and not a runtime check: importing `main.ts` runs
 * `bootstrap()` and binds a port, so the only way to assert the wiring is to
 * read the file, exactly as `push-channel.guard.test.ts` does for its decision.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const MAIN = join(REPO, 'apps', 'api', 'src', 'main.ts');

const main = readFileSync(MAIN, 'utf8');

describe('notification scheduler is wired into the API bootstrap (#802)', () => {
  it('imports the notification scheduler singleton', () => {
    expect(main).toMatch(
      /import\s*\{[^}]*notificationScheduler[^}]*\}\s*from\s*['"]@\/modules\/notifications\/scheduler\.service['"]/
    );
  });

  it('calls initialize() on startup', () => {
    expect(main).toMatch(/notificationScheduler\.initialize\(\)/);
  });

  it('calls stopAll() on shutdown', () => {
    expect(main).toMatch(/notificationScheduler\.stopAll\(\)/);
  });
});
