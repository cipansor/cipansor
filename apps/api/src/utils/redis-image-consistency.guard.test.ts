import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The Redis image CI and E2E run must be the one `docker-compose.yml` runs.
 *
 * The three were bumped together by hand, so a Dependabot bump of the compose
 * image alone (redis 7 -> 8, PR #1134) left the workflow services on the old
 * image: CI stayed green while testing a Redis the app no longer ships
 * against. Nothing failed, because nothing compared the two. This guard is
 * that comparison — when one moves, the other must move with it.
 *
 * Only the `image:` line is compared (the tag, not the registry); the
 * workflows pin `redis:<tag>` exactly as the compose file does.
 */
const ROOT = resolve(__dirname, '../../../..');
const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/e2e-tests.yml'];

const REDIS_IMAGE = /^\s*image:\s*(redis:[^\s#]+)\s*$/gm;

function redisImages(file: string): string[] {
  return [...readFileSync(resolve(ROOT, file), 'utf8').matchAll(REDIS_IMAGE)].map((m) => m[1]);
}

describe('the redis image', () => {
  it('is declared once in docker-compose.yml', () => {
    expect(redisImages('docker-compose.yml')).toHaveLength(1);
  });

  it('is the same image in docker-compose.yml and every workflow service', () => {
    const [composeImage] = redisImages('docker-compose.yml');

    for (const workflow of WORKFLOWS) {
      const images = redisImages(workflow);
      expect(images.length, `${workflow} declares no redis service`).toBeGreaterThan(0);
      expect(
        images,
        `${workflow} runs ${images.join(', ')} but docker-compose.yml runs ${composeImage}`
      ).toEqual(images.map(() => composeImage));
    }
  });
});
