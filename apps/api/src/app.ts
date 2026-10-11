import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { config } from '@/config';
import { buildCorsMiddleware } from '@/config/cors';
import { logger } from '@/lib/logger';
import { databaseReady } from '@/lib/database-ready';
import { errorHandler, notFoundHandler } from '@/middleware/error';
import { csrfProtection } from '@/middleware/csrf';
import {
  defaultLimiter,
  authLimiter,
  rateLimitEnabled,
  uploadsServeLimiter,
} from '@/middleware/rate-limit';
import { normalizePagination } from '@/middleware/normalize-pagination';
import { swaggerSpec } from '@/config/swagger';

// Import routes
import authRoutes from '@/modules/auth/auth.routes';
import userRoutes from '@/modules/users/user.routes';
import unitRoutes from '@/modules/units/unit.routes';
import studentRoutes from '@/modules/students/student.routes';
import classRoutes from '@/modules/classes/class.routes';
import assignmentsRoutes from '@/modules/assignments/assignments.routes';
import academicYearRoutes from '@/modules/academic-years/academic-year.routes';
import attendanceRoutes from '@/modules/attendance/attendance.routes';
import tahfidzRoutes from '@/modules/tahfidz/tahfidz.routes';
import dormitoryRoutes from '@/modules/dormitories/dormitories.routes';
import permitRoutes from '@/modules/permits/permits.routes';
import violationRoutes from '@/modules/violations/violations.routes';
import rewardRoutes from '@/modules/rewards/rewards.routes';
import certificatesRoutes from '@/modules/certificates/certificates.routes';
import financeRoutes from '@/modules/finance/finance.routes';
import foundationRoutes from '@/modules/foundation/foundation.routes';
// Legacy `psb` module has been superseded by the unified `admissions` module
// (mounted at `/api/admissions`). Removed from the router so external callers
// do not silently keep using endpoints whose data shape and field names have
// diverged from the new module (e.g. `name` vs `fullName`, `registrationNumber`
// vs `registrationNo`).
import hrRoutes from '@/modules/hr/hr.routes';
import libraryRoutes from '@/modules/library/library.routes';
import healthRoutes from '@/modules/health/health.routes';
import inventoryRoutes from '@/modules/inventory/inventory.routes';
import notificationRoutes from '@/modules/notifications/notifications.routes';
import messageRoutes from '@/modules/messages/messages.routes';
import curriculumRoutes from '@/modules/curriculum/curriculum.routes';
import assessmentRoutes from '@/modules/assessment/assessment.routes';
import { cbtRoutes } from '@/modules/cbt/cbt.routes';
import alumniRoutes from '@/modules/alumni/alumni.routes';
import analyticsRoutes from '@/modules/analytics/analytics.routes';
import parentRoutes from '@/modules/parent/parent.routes';
import reportingRoutes from '@/modules/reporting/reporting.routes';
import rolesRoutes from '@/modules/roles/roles.routes';
import { takhosusRoutes } from '@/modules/takhosus';
import { muhasabahRoutes } from '@/modules/muhasabah';
import { donationRoutes } from '@/modules/donation';
import { admissionsRoutes } from '@/modules/admissions';
import { wilayahRoutes } from '@/modules/wilayah';
import { environmentRoutes } from '@/modules/environment';
import { kurikulumMerdekaRoutes } from '@/modules/kurikulum-merdeka';
import { facilitiesRoutes } from '@/modules/facilities';
import { studentComplianceRoutes } from '@/modules/student-compliance';
import { teacherComplianceRoutes } from '@/modules/teacher-compliance';
import { financeEnhancementRoutes } from '@/modules/finance-enhancement';
import { walletRoutes } from '@/modules/wallet';
import { canteenRoutes } from '@/modules/canteen';
import { laundryRoutes } from '@/modules/laundry';
import { payrollRoutes } from '@/modules/payroll';
import portfolioRoutes from '@/modules/portfolio/portfolio.routes';
import ibadahRoutes from '@/modules/ibadah/ibadah.routes';
import raporPesantrenRoutes from '@/modules/rapor-pesantren/rapor-pesantren.routes';
import { procurementRoutes } from '@/modules/procurement/procurement.routes';
import { supplierRoutes } from '@/modules/suppliers/suppliers.routes';
import { uploadRoutes } from '@/modules/upload/upload.routes';

// Phase 12 routes
import extracurricularRoutes from '@/modules/extracurricular/extracurricular.routes';
import counselingRoutes from '@/modules/counseling/counseling.routes';
import dutyRosterRoutes from '@/modules/duty-roster/duty-roster.routes';
import mealsRoutes from '@/modules/meals/meals.routes';
import calendarRoutes from '@/modules/calendar/calendar.routes';
import homeroomRoutes from '@/modules/homeroom/homeroom.routes';
import kitabProgressRoutes from '@/modules/kitab-progress/kitab-progress.routes';
import muhadhorohRoutes from '@/modules/muhadhoroh/muhadhoroh.routes';
import muhadatsahRoutes from '@/modules/muhadatsah/muhadatsah.routes';
import emisRoutes from '@/modules/emis/emis.routes';
import { dapodikRouter } from '@/modules/dapodik/dapodik.routes';
import { qualityRoutes } from '@/modules/quality/quality.routes';
import correspondenceRoutes from '@/modules/correspondence/correspondence.routes';
import esignRoutes from '@/modules/esign/esign.routes';
import riskRoutes from '@/modules/risk/risk.routes';
import { complaintsRoutes } from '@/modules/complaints/complaints.routes';
import { practicumRoutes } from '@/modules/practicum/practicum.routes';
import { studentOrgRoutes } from '@/modules/student-org/student-org.routes';
import { researchRoutes } from '@/modules/research/research.routes';
import nonFormalRoutes from '@/modules/non-formal';
import socialServiceRoutes from '@/modules/social-service';
import performanceAgreementRoutes from '@/modules/performance-management/pk.routes';

// Enhancement module routes
import { paudAssessmentRoutes } from '@/modules/paud-assessment';
import { paudReportRouter } from '@/modules/paud-report';
import { dailyReportRoutes } from '@/modules/daily-report';
import { murojaahRoutes } from '@/modules/murojaah';
import { simaanRoutes } from '@/modules/simaan';
import { dashboardEnhancementRoutes } from '@/modules/dashboard-enhancement';
import { sanadCertificateRouter } from '@/modules/sanad-certificate';
import dashboardRoutes from '@/modules/dashboard/dashboard.routes';
import receptionRoutes from '@/modules/reception/reception.routes';
import marketingRoutes from '@/modules/marketing/marketing.routes';
import { announcementRoutes } from '@/modules/announcements';
import { chatbotRoutes } from '@/modules/chatbot';
import projectRoutes from '@/modules/project/project.routes';

// New modules
import perencanaanRoutes from '@/modules/perencanaan/perencanaan.routes';
import pengawasanRoutes from '@/modules/pengawasan/pengawasan.routes';
import syariahRoutes from '@/modules/syariah/syariah.routes';
import lingkunganRoutes from '@/modules/lingkungan/lingkungan.routes';
import talentaRoutes from '@/modules/talenta/talenta.routes';
import organisasiRoutes from '@/modules/organisasi/organisasi.routes';
import tataLaksanaRoutes from '@/modules/tatalaksana/tatalaksana.routes';
import businessUnitRoutes from '@/modules/business-unit/business-unit.routes';

// Create Express app
const app = express();

// Trust proxy (for production behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(buildCorsMiddleware(config.cors.origins));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Parse the session cookies the auth module issues. `authenticate` reads the
// access token from `cipansor_at` when no Authorization header is present, so
// every browser request is authenticated without any JavaScript-visible token.
app.use(cookieParser());
// Once the session lives in an HttpOnly cookie the browser sends it on every
// request, including ones another site forces. Reject an unsafe request that
// carries a session cookie but no matching double-submit header. Read-only
// routes and bearer-only clients are untouched (see middleware/csrf.ts). Once,
// here, ahead of every router.
app.use(csrfProtection);

// Express 5 leaves `req.body` **undefined** when a request carries no body (or
// no matching Content-Type); Express 4 defaulted it to {}. Forty-two
// controllers destructure `req.body` directly, so any of them reached without
// a body throws a TypeError and answers 500 with no useful message. That is
// exactly how POST /auth/logout — which the web client calls with no body —
// broke: it 500'd before revoking anything, leaving refresh tokens live for
// their full 30-day lifetime after logout.
//
// Restoring the Express 4 default here fixes the whole class at once rather
// than relying on every controller to remember a `?? {}`. It is deliberately
// placed after the parsers so a genuinely parsed body is never overwritten.
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

// Compression
app.use(compression());

// Stored uploads hold personal data (student photos/documents), so serving
// them requires a valid access token — via Authorization header or ?token=
// (see uploadsAuth). Directory listing stays off; static only serves files.
//
// `/uploads` carries its OWN limiter ahead of auth (see buildUploadsMiddleware
// and `uploadsServeLimiter`) and is excluded from the global limiter below, so
// every `/uploads` request costs exactly one slot of the uploads budget and
// none of the API budget — a missing file that `express.static` passes on
// included. Auth still gates it in every environment. In development and test
// no limiter is mounted at all.
import path from 'path';
import { uploadsAuth } from './middleware/upload';

/**
 * Build the `/uploads` middleware chain for an environment.
 *
 * Rate limiting is prepended only where it is in force (`rateLimitEnabled`), so
 * development and test are not silently throttled by the production limiter.
 * Authentication (`uploadsAuth`) is unconditional: stored uploads are private
 * in every environment.
 */
export function buildUploadsMiddleware(env: string) {
  return [
    ...(rateLimitEnabled(env) ? [uploadsServeLimiter] : []),
    uploadsAuth,
    express.static(path.join(process.cwd(), 'public/uploads')),
  ];
}

app.use('/uploads', ...buildUploadsMiddleware(config.env));

/**
 * The global default limiter.
 *
 * `buildUploadsMiddleware` already limits `/uploads` with its own budget; the
 * global pass must not touch that prefix, or a missing file that falls through
 * `express.static` would also spend an API slot. Every non-upload route still
 * gets the limiter once. Inactive entirely in development and test.
 */
export function buildGlobalLimiter(env: string): express.RequestHandler {
  if (!rateLimitEnabled(env)) {
    return (_req, _res, next) => next();
  }
  return (req, res, next) => {
    if (req.path === '/uploads' || req.path.startsWith('/uploads/')) {
      return next();
    }
    return defaultLimiter(req, res, next);
  };
}

app.use(buildGlobalLimiter(config.env));

// Logging
if (config.env !== 'test') {
  app.use(
    morgan('combined', {
      stream: {
        write: (message: string) => logger.http(message.trim()),
      },
    })
  );
}

// Readiness check endpoint (not rate limited).
//
// `commit` is the git SHA the image was built from (GIT_COMMIT_SHA, baked in by
// the Azure release workflows). Those workflows poll this endpoint through the
// public address until it reports the SHA they released, so "deployed" means
// the new code is answering, not just that a container was started. Null for
// images built without it, such as the VM's own builds.
//
// `environment` is `config.appEnv` — the DEPLOYED COPY (`local`/`staging`/
// `production`) — not `NODE_ENV`. Both images set `NODE_ENV=production`, so this
// field used to report "production" from staging too, and anyone debugging
// staging read the wrong answer. `nodeEnv` keeps the build mode visible for
// what it actually means.
//
// It is also the readiness check (#665): a process whose Postgres is
// unreachable cannot serve a single query, so it answers 503 instead of a
// healthy 200, and the release workflow keeps waiting rather than counting it
// as deployed. The probe is bounded and shared (`databaseReady`), because this
// endpoint is public and not rate limited.
app.get('/health', async (_req, res) => {
  const ready = await databaseReady();
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    database: ready ? 'ok' : 'unreachable',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    commit: process.env.GIT_COMMIT_SHA || null,
    environment: config.appEnv,
    nodeEnv: config.env,
  });
});

// Swagger API Documentation (disabled in production for security)
if (config.env !== 'production') {
  console.info('App: swaggerSpec paths:', Object.keys(swaggerSpec.paths || {}));
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'Cipansor API Documentation',
    })
  );

  // Swagger JSON endpoint
  app.get('/api/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

// API routes
const apiRouter = express.Router();

// Query strings are strings; several services take `limit`/`page` as numbers
// and hand them to Prisma unvalidated. Normalise once here so no module can
// forget. See middleware/normalize-pagination.ts.
apiRouter.use(normalizePagination);

// Apply the strict brute-force limiter to credential-bearing endpoints ONLY.
//
// It used to guard the whole /auth router, which also covered GET /auth/me —
// the session lookup the web app issues on every page load. At 5 requests per
// minute that returns 429 to a user who simply clicks through six pages, and
// because express-rate-limit keys on IP it fires for an entire school sharing
// one NAT gateway, not per user. /me, /logout and /2fa/status are read-only
// session calls with nothing to brute force, so they stay unlimited.
// (2fa/enable, 2fa/login and 2fa/disable carry their own twoFactorLimiter.)
if (config.env !== 'test' && config.env !== 'development') {
  apiRouter.use('/auth/login', authLimiter);
  apiRouter.use('/auth/register', authLimiter);
  apiRouter.use('/auth/refresh', authLimiter);
  apiRouter.use('/auth/password', authLimiter);
}
apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/units', unitRoutes);
apiRouter.use('/students', studentRoutes);
apiRouter.use('/classes', classRoutes);
apiRouter.use('/assignments', assignmentsRoutes);
apiRouter.use('/academic-years', academicYearRoutes);
apiRouter.use('/attendance', attendanceRoutes);
apiRouter.use('/tahfidz', tahfidzRoutes);
apiRouter.use('/dormitories', dormitoryRoutes);
apiRouter.use('/permits', permitRoutes);
apiRouter.use('/violations', violationRoutes);
apiRouter.use('/rewards', rewardRoutes);
apiRouter.use('/certificates', certificatesRoutes);
apiRouter.use('/finance', financeRoutes);
apiRouter.use('/foundation', foundationRoutes);
// `/api/psb` was removed; use `/api/admissions` instead.
apiRouter.use('/marketing', marketingRoutes);
apiRouter.use('/hr', hrRoutes);
apiRouter.use('/library', libraryRoutes);
apiRouter.use('/health', healthRoutes);
apiRouter.use('/inventory', inventoryRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/messages', messageRoutes);
apiRouter.use('/curriculum', curriculumRoutes);
apiRouter.use('/assessment', assessmentRoutes);
apiRouter.use('/cbt', cbtRoutes);
apiRouter.use('/alumni', alumniRoutes);
apiRouter.use('/analytics', analyticsRoutes);
apiRouter.use('/parent', parentRoutes);
apiRouter.use('/reports', reportingRoutes);
apiRouter.use('/roles', rolesRoutes);
apiRouter.use('/takhosus', takhosusRoutes);
apiRouter.use('/muhasabah', muhasabahRoutes);
apiRouter.use('/donation', donationRoutes);
apiRouter.use('/admissions', admissionsRoutes);
apiRouter.use('/wilayah', wilayahRoutes);
apiRouter.use('/environment', environmentRoutes);
apiRouter.use('/kurikulum-merdeka', kurikulumMerdekaRoutes);
apiRouter.use('/facilities', facilitiesRoutes);
apiRouter.use('/student-compliance', studentComplianceRoutes);
apiRouter.use('/teacher-compliance', teacherComplianceRoutes);
apiRouter.use('/finance-enhancement', financeEnhancementRoutes);
apiRouter.use('/wallet', walletRoutes);
apiRouter.use('/canteen', canteenRoutes);
apiRouter.use('/laundry', laundryRoutes);
apiRouter.use('/payroll', payrollRoutes);
apiRouter.use('/portfolio', portfolioRoutes);
apiRouter.use('/ibadah', ibadahRoutes);
apiRouter.use('/rapor-pesantren', raporPesantrenRoutes);
apiRouter.use('/procurement', procurementRoutes);
apiRouter.use('/suppliers', supplierRoutes);
apiRouter.use('/upload', uploadRoutes);

// Phase 12 routes
apiRouter.use('/extracurricular', extracurricularRoutes);
apiRouter.use('/counseling', counselingRoutes);
apiRouter.use('/duty-roster', dutyRosterRoutes);
apiRouter.use('/meals', mealsRoutes);
apiRouter.use('/calendar', calendarRoutes);
apiRouter.use('/homeroom', homeroomRoutes);
apiRouter.use('/kitab-progress', kitabProgressRoutes);
apiRouter.use('/muhadhoroh', muhadhorohRoutes);
apiRouter.use('/muhadatsah', muhadatsahRoutes);
apiRouter.use('/emis', emisRoutes);
apiRouter.use('/dapodik', dapodikRouter);
apiRouter.use('/quality', qualityRoutes);
apiRouter.use('/correspondence', correspondenceRoutes);
apiRouter.use('/esign', esignRoutes);
apiRouter.use('/risk', riskRoutes);
apiRouter.use('/complaints', complaintsRoutes);
apiRouter.use('/practicum', practicumRoutes);
apiRouter.use('/student-org', studentOrgRoutes);
apiRouter.use('/research', researchRoutes);
apiRouter.use('/non-formal', nonFormalRoutes);
apiRouter.use('/social-service', socialServiceRoutes);
apiRouter.use('/performance-agreements', performanceAgreementRoutes);

// Enhancement modules
apiRouter.use('/paud-assessment', paudAssessmentRoutes);
apiRouter.use('/paud-report', paudReportRouter);
apiRouter.use('/daily-report', dailyReportRoutes);
apiRouter.use('/murojaah', murojaahRoutes);
apiRouter.use('/simaan', simaanRoutes);
apiRouter.use('/dashboard-enhancement', dashboardEnhancementRoutes);
apiRouter.use('/sanad', sanadCertificateRouter);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/reception', receptionRoutes);
apiRouter.use('/announcements', announcementRoutes);
apiRouter.use('/chatbot', chatbotRoutes);
apiRouter.use('/projects', projectRoutes);

// New modules
apiRouter.use('/perencanaan', perencanaanRoutes);
apiRouter.use('/pengawasan', pengawasanRoutes);
apiRouter.use('/syariah', syariahRoutes);
apiRouter.use('/lingkungan', lingkunganRoutes);
apiRouter.use('/talenta', talentaRoutes);
apiRouter.use('/organisasi', organisasiRoutes);
apiRouter.use('/tata-laksana', tataLaksanaRoutes);
apiRouter.use('/business-units', businessUnitRoutes);

// API info
apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'Cipansor API',
    version: '1.0.0',
    description: 'Yayasan Pesantren Cipansor - Islamic Education Institution Management System',
    documentation: '/api/docs',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      units: '/api/units',
      students: '/api/students',
      classes: '/api/classes',
      academicYears: '/api/academic-years',
      attendance: '/api/attendance',
      tahfidz: '/api/tahfidz',
      takhosus: '/api/takhosus',
      muhasabah: '/api/muhasabah',
      dormitories: '/api/dormitories',
      permits: '/api/permits',
      violations: '/api/violations',
      rewards: '/api/rewards',
      finance: '/api/finance',
      donation: '/api/donation',
      foundation: '/api/foundation',
      admissions: '/api/admissions',
      marketing: '/api/marketing',
      hr: '/api/hr',
      library: '/api/library',
      health: '/api/health',
      inventory: '/api/inventory',
      notifications: '/api/notifications',
      curriculum: '/api/curriculum',
      assessment: '/api/assessment',
      alumni: '/api/alumni',
      analytics: '/api/analytics',
      parent: '/api/parent',
      reports: '/api/reports',
      // Phase 12 endpoints
      extracurricular: '/api/extracurricular',
      counseling: '/api/counseling',
      dutyRoster: '/api/duty-roster',
      meals: '/api/meals',
      calendar: '/api/calendar',
      homeroom: '/api/homeroom',
      kitabProgress: '/api/kitab-progress',
      muhadhoroh: '/api/muhadhoroh',
      muhadatsah: '/api/muhadatsah',
      emis: '/api/emis',
      dapodik: '/api/dapodik',
      wilayah: '/api/wilayah',
      environment: '/api/environment',
      kurikulumMerdeka: '/api/kurikulum-merdeka',
      facilities: '/api/facilities',
      studentCompliance: '/api/student-compliance',
      teacherCompliance: '/api/teacher-compliance',
      financeEnhancement: '/api/finance-enhancement',
      wallet: '/api/wallet',
      canteen: '/api/canteen',
      laundry: '/api/laundry',
      portfolio: '/api/portfolio',
      ibadah: '/api/ibadah',
      raporPesantren: '/api/rapor-pesantren',
      reception: '/api/reception',
      // New modules
      perencanaan: '/api/perencanaan',
      pengawasan: '/api/pengawasan',
      syariah: '/api/syariah',
      lingkungan: '/api/lingkungan',
      talenta: '/api/talenta',
      organisasi: '/api/organisasi',
      tataLaksana: '/api/tata-laksana',
      businessUnits: '/api/business-units',
    },
  });
});

// Mount API router
app.use('/api', apiRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export { app };
