import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

// For tsx/ts-node, use import.meta.url approach
const modulesPath = path.join(process.cwd(), 'src', 'modules');
console.log('Swagger API patterns:', [
  `${modulesPath}/**/*.routes.ts`,
  `${modulesPath}/**/routes.ts`,
]);

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Cipansor API',
      version: '1.0.0',
      description: `
# Sistem Manajemen Yayasan Pesantren Cipansor

Platform terintegrasi untuk pengelolaan TK, SD IT, SMP IT, dan SMA Al-Qur'an dengan fokus tahfidz dan kurikulum pesantren.

## Features

- **Multi-unit Management** - Kelola semua unit dari satu dashboard
- **Role-based Access** - Super Admin, Unit Admin, Teacher, Staff, Student, Parent
- **Tahfidz Tracking** - Ziyadah, Murojaah, Tasmi, Penilaian hafalan
- **Pesantren Management** - Asrama, perizinan, pelanggaran, reward points
- **Financial Management** - Pembayaran SPP, tagihan, laporan keuangan
- **Academic Tracking** - Kurikulum, absensi, nilai, raport
- **Alumni Management** - Data alumni, karir, donasi, event
- **Analytics Dashboard** - Statistik dan laporan komprehensif

## Authentication

Semua endpoint (kecuali login) memerlukan JWT token:

\`\`\`
Authorization: Bearer <access_token>
\`\`\`

Token didapat dari endpoint POST /api/auth/login
      `,
      contact: {
        name: 'Cipansor Team',
        email: 'dev@cipansor.or.id',
      },
      // The repository's licence (LICENSE, package.json, decisions/lisensi.md);
      // swagger.test.ts keeps the two from drifting apart again.
      license: {
        name: 'Apache-2.0',
        url: 'https://www.apache.org/licenses/LICENSE-2.0',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management' },
      { name: 'Units', description: 'Unit/Lembaga management' },
      { name: 'Students', description: 'Student management' },
      { name: 'Teachers', description: 'Teacher management' },
      { name: 'Classes', description: 'Class management' },
      { name: 'Academic Years', description: 'Academic year management' },
      { name: 'Attendance', description: 'Attendance recording' },
      { name: 'Tahfidz', description: 'Tahfidz tracking' },
      { name: 'Dormitories', description: 'Dormitory management' },
      { name: 'Permits', description: 'Student permits' },
      { name: 'Violations', description: 'Student violations' },
      { name: 'Rewards', description: 'Student rewards' },
      { name: 'Finance', description: 'Financial management' },
      { name: 'Foundation', description: 'Foundation/Yayasan management' },
      { name: 'PSB', description: 'Penerimaan Santri Baru' },
      { name: 'HR', description: 'Staff attendance and leave' },
      { name: 'Library', description: 'Library management' },
      { name: 'Health', description: 'Health/UKS management' },
      { name: 'Inventory', description: 'Asset inventory' },
      { name: 'Notifications', description: 'Notifications and announcements' },
      { name: 'Curriculum', description: 'Curriculum management' },
      { name: 'Assessment', description: 'Exams and grades' },
      { name: 'Alumni', description: 'Alumni management' },
      { name: 'Analytics', description: 'Analytics and statistics' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Invalid input data' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      field: { type: 'string' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 10 },
            total: { type: 'integer', example: 100 },
            totalPages: { type: 'integer', example: 10 },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Ahmad Fauzi' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', example: '081234567890' },
            role: {
              type: 'string',
              enum: ['SUPER_ADMIN', 'UNIT_ADMIN', 'TEACHER', 'STAFF', 'STUDENT', 'PARENT'],
            },
            unitId: { type: 'string', format: 'uuid', nullable: true },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Student: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            unitId: { type: 'string', format: 'uuid' },
            nis: { type: 'string', example: '2024001' },
            nisn: { type: 'string', example: '0012345678' },
            gender: { type: 'string', enum: ['MALE', 'FEMALE'] },
            birthPlace: { type: 'string', example: 'Sukabumi' },
            birthDate: { type: 'string', format: 'date' },
            address: { type: 'string' },
            parentName: { type: 'string' },
            parentPhone: { type: 'string' },
            status: { type: 'string', example: 'active' },
          },
        },
        Unit: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Pondok Pesantren Al-Hikmah' },
            type: {
              type: 'string',
              enum: ['PESANTREN', 'PAUD', 'SD_IT', 'SMP_IT', 'SMA_QURAN', 'OTHER'],
            },
            address: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string', format: 'email' },
          },
        },
        Class: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            unitId: { type: 'string', format: 'uuid' },
            academicYearId: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Kelas 7A' },
            level: { type: 'integer', example: 7 },
            homeroomTeacherId: { type: 'string', format: 'uuid', nullable: true },
          },
        },
        Alumni: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            unitId: { type: 'string', format: 'uuid' },
            registrationNo: { type: 'string', example: 'ALM-2020-0001' },
            name: { type: 'string' },
            gender: { type: 'string', enum: ['MALE', 'FEMALE'] },
            graduationYear: { type: 'integer', example: 2020 },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            status: {
              type: 'string',
              enum: ['REGISTERED', 'VERIFIED', 'ACTIVE', 'INACTIVE'],
            },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'admin@alhikmah.sch.id' },
            password: { type: 'string', format: 'password', example: 'Admin123!' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: {
              type: 'object',
              properties: {
                user: { $ref: '#/components/schemas/User' },
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Unauthorized - Invalid or missing token',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
              },
            },
          },
        },
        Forbidden: {
          description: 'Forbidden - Insufficient permissions',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Access denied' },
              },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Resource not found' },
              },
            },
          },
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Invalid input data',
                  details: [{ field: 'email', message: 'Invalid email format' }],
                },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [`${modulesPath}/**/*.routes.ts`, `${modulesPath}/**/routes.ts`],
};

const generatedSpec = swaggerJsdoc(options) as { paths?: Record<string, unknown> };
console.log('Swagger paths found:', Object.keys(generatedSpec.paths || {}));

// Deep clone to prevent mutation issues
export const swaggerSpec = JSON.parse(JSON.stringify(generatedSpec));
