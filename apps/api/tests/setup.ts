/**
 * Test setup file for Vitest
 * This file runs before all tests
 */

import { beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-purposes-min-32-chars';
process.env.JWT_EXPIRES_IN = '1h';
// Outbound links are asserted against the real host (see
// utils/verification-url.test.ts), so pin the public site URL here. A
// developer's local .env points it at http://localhost:3000, which would
// otherwise fail tests that are about the *shape* of the URL, not its value.
// Set before `config` is imported; dotenv never overrides an existing var.
process.env.PUBLIC_SITE_URL = 'https://cipansor.or.id';
// The portal host is pinned too: `utils/signature-url.ts` allows a signature
// image only on a host the yayasan serves, and a developer's `.env` points both
// hosts at localhost — the absolute-URL branch of that rule then has no real
// host to match and the test would assert against the dev value.
process.env.PORTAL_URL = 'https://portal.cipansor.or.id';
// Unit tests mock Prisma, so a stub URL is fine. The opt-in DB integration
// suite (RUN_DB_TESTS=1) needs a real connection, so leave the environment's
// DATABASE_URL untouched in that mode.
if (!process.env.RUN_DB_TESTS) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/cipansor_test';
}

// Mock console.log in tests to reduce noise
beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Global test utilities
export const testHelpers = {
  /**
   * Generate a valid JWT token for testing
   */
  generateTestToken: (payload: Record<string, unknown> = {}) => {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      {
        userId: 'test-user-id',
        email: 'test@example.com',
        role: 'SUPER_ADMIN',
        ...payload,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  },

  /**
   * Create mock request object
   */
  createMockRequest: (overrides = {}) => ({
    body: {},
    params: {},
    query: {},
    headers: {},
    user: {
      userId: 'test-user-id',
      email: 'test@example.com',
      role: 'SUPER_ADMIN',
    },
    ...overrides,
  }),

  /**
   * Create mock response object
   */
  createMockResponse: () => {
    const res: Record<string, unknown> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    res.send = vi.fn().mockReturnValue(res);
    res.setHeader = vi.fn().mockReturnValue(res);
    return res;
  },

  /**
   * Create mock next function
   */
  createMockNext: () => vi.fn(),
};

// Export for use in tests
export default testHelpers;
