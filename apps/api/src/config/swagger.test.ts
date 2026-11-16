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

  /**
   * The leave-decision endpoints answer 409 (`Errors.conflict`) when a decision
   * lands between the read and the write — the losing caller is told to reload
   * (`hr.service.ts`, from PR #668) — and `/approve` answers 400 for rejecting a
   * leave that is already approved. The `@swagger` blocks listed only 200, so
   * the served `/api/docs` hid the paths a client has to handle (#1053).
   */
  describe('leave-decision endpoints state their conflict and refusal responses', () => {
    const path = (p: string) =>
      swaggerSpec.paths[p] as Record<string, { responses: Record<string, unknown> }>;

    it('PUT /api/hr/leaves/{id} documents 409', () => {
      expect(path('/api/hr/leaves/{id}').put.responses['409']).toBeDefined();
    });

    it('PATCH /api/hr/leaves/{id}/approve documents 409 and 400', () => {
      const patch = path('/api/hr/leaves/{id}/approve').patch.responses;
      expect(patch['409']).toBeDefined();
      expect(patch['400']).toBeDefined();
    });

    it('PATCH /api/hr/leaves/{id}/cancel documents 409', () => {
      expect(path('/api/hr/leaves/{id}/cancel').patch.responses['409']).toBeDefined();
    });
  });
});
