import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { swaggerSpec } from './swagger';

/**
 * The OpenAPI document states the licence of the code that serves it. It said
 * MIT for weeks after the repository moved to Apache-2.0 (#723, #725), because
 * nothing compared the two.
 */
describe('swagger spec', () => {
  it("states the repository's licence, the one package.json declares", () => {
    const root = resolve(__dirname, '..', '..', '..', '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      license: string;
    };
    expect(swaggerSpec.info.license.name).toBe(pkg.license);
    expect(swaggerSpec.info.license.url).toContain('apache.org/licenses/LICENSE-2.0');
  });
});
