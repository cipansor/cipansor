import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma';
import { CBTService } from '../cbt.service';

vi.mock('@prisma/client', () => ({
  Prisma: {
    TransactionIsolationLevel: {
      Serializable: 'Serializable',
    },
    Decimal: vi.fn((val) => val),
    JsonNull: 'JsonNull',
    DbNull: 'DbNull',
  },
  QuestionType: {
    MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
    TRUE_FALSE: 'TRUE_FALSE',
    ESSAY: 'ESSAY',
  },
}));

// Mock external dependencies
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    questionBank: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    question: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    exam: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    examAttempt: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    examAnswer: {
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    examSecurityLog: {
      create: vi.fn(),
    },
    grade: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    teacher: {
      findUnique: vi.fn(),
    },
    student: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callbackOrPromises, _options?) => {
      if (typeof callbackOrPromises === 'function') return callbackOrPromises(prisma);
      return Promise.resolve(callbackOrPromises);
    }),
  },
}));

describe('CBT Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Question Banks and Questions', () => {
    it('should create question bank', async () => {
      const dto = {
        unitId: 'unit-1',
        teacherId: 'user-1',
        title: 'Bank Soal Matematika K13',
      };

      vi.mocked(prisma.questionBank.create).mockResolvedValue({ id: 'bank-1', ...dto } as any);

      await CBTService.createQuestionBank(dto);

      expect(prisma.questionBank.create).toHaveBeenCalledWith({
        data: expect.objectContaining(dto),
      });
    });

    it('should add question to bank if authorized', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue({
        id: 'bank-1',
        teacher: { userId: 'user-1' },
      } as any);
      vi.mocked(prisma.question.create).mockResolvedValue({ id: 'q-1' } as any);

      const dto = {
        bankId: 'bank-1',
        type: 'MULTIPLE_CHOICE' as any,
        content: 'Berapa 2+2?',
        options: [{ id: 'opt-1', text: '4' }],
        answerKey: 'opt-1',
        points: 5,
      };

      await CBTService.addQuestion(dto, { id: 'user-1', role: 'TEACHER' });

      expect(prisma.question.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          content: 'Berapa 2+2?',
          points: 5,
          order: 0,
        }),
      });
    });

    it('refuses duplicate option ids before writing the question', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue({
        id: 'bank-1',
        teacher: { userId: 'user-1' },
      } as any);

      await expect(
        CBTService.addQuestion(
          {
            bankId: 'bank-1',
            type: 'MULTIPLE_CHOICE' as any,
            content: 'Berapa 2+2?',
            options: [
              { id: 'A', text: '3' },
              { id: 'C', text: '4' },
              { id: 'D', text: '5' },
              { id: 'D', text: '6' },
            ],
            answerKey: 'D',
          },
          { id: 'user-1', role: 'TEACHER' }
        )
      ).rejects.toThrow(/lebih dari sekali/i);
      expect(prisma.question.create).not.toHaveBeenCalled();
    });

    it('should throw error if unauthorized to add question', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue({
        id: 'bank-1',
        teacher: { userId: 'user-2' },
      } as any);

      await expect(
        CBTService.addQuestion(
          { bankId: 'bank-1', type: 'ESSAY' as any, content: 'Sebutkan...' },
          { id: 'user-1', role: 'TEACHER' }
        )
      ).rejects.toThrow('You do not have permission');
    });
  });

  describe('Exam Scheduling & Grading', () => {
    it('should create an exam if authorized', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue({
        id: 'bank-1',
        isActive: true,
        teacher: { userId: 'user-1' },
      } as any);
      vi.mocked(prisma.exam.create).mockResolvedValue({ id: 'exam-1' } as any);

      const dto = {
        unitId: 'unit-1',
        academicYearId: 'ay-1',
        subjectId: 'sub-1',
        classId: 'cls-1',
        teacherId: 'user-1',
        type: 'MIDTERM' as any,
        title: 'UTS Matematika',
        scheduledAt: new Date(),
        questionBankId: 'bank-1',
      };

      await CBTService.createExam(dto, { id: 'user-1', role: 'TEACHER', unitId: 'unit-1' });

      expect(prisma.exam.create).toHaveBeenCalled();
    });

    it('should delete an exam with no attempts', async () => {
      vi.mocked(prisma.exam.findUnique).mockResolvedValue({
        id: 'exam-1',
        unitId: 'unit-1',
        teacher: { userId: 'user-1' },
        _count: { attempts: 0 },
      } as any);
      vi.mocked(prisma.exam.delete).mockResolvedValue({ id: 'exam-1' } as any);

      const result = await CBTService.deleteExam('exam-1', {
        id: 'admin',
        role: 'SUPER_ADMIN',
        unitId: null,
      });

      expect(prisma.exam.delete).toHaveBeenCalledWith({ where: { id: 'exam-1' } });
      expect(result).toEqual({ id: 'exam-1' });
    });

    it('should refuse to delete an exam that already has attempts', async () => {
      vi.mocked(prisma.exam.findUnique).mockResolvedValue({
        id: 'exam-1',
        unitId: 'unit-1',
        teacher: { userId: 'user-1' },
        _count: { attempts: 3 },
      } as any);

      await expect(
        CBTService.deleteExam('exam-1', { id: 'admin', role: 'SUPER_ADMIN', unitId: null })
      ).rejects.toThrow(/attempts/i);
      expect(prisma.exam.delete).not.toHaveBeenCalled();
    });

    it('should allow teacher to grade essay answers and recalculate total score', async () => {
      vi.mocked(prisma.examAttempt.findUnique)
        .mockResolvedValueOnce({
          id: 'attempt-1',
          status: 'NEEDS_REVIEW',
          exam: { unitId: 'unit-1', questionBankId: 'bank-1', teacher: { userId: 'user-1' } },
        } as any)
        // Second call is the fresh status re-check inside the transaction
        .mockResolvedValueOnce({
          status: 'NEEDS_REVIEW',
        } as any);

      vi.mocked(prisma.question.findUnique).mockResolvedValue({
        id: 'q-1',
        bankId: 'bank-1',
        points: 10,
        type: 'ESSAY',
      } as any);

      vi.mocked(prisma.examAnswer.findUnique).mockResolvedValue({
        id: 'ans-1',
      } as any);
      vi.mocked(prisma.examAnswer.update).mockResolvedValue({ id: 'ans-1' } as any);
      vi.mocked(prisma.examAnswer.findMany).mockResolvedValue([
        { id: 'ans-1', score: 10, question: { type: 'ESSAY' } },
        { id: 'ans-2', score: 20, question: { type: 'MULTIPLE_CHOICE' } },
      ] as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({ id: 'attempt-1', score: 30 } as any);

      const result = await CBTService.gradeEssayAnswer(
        'attempt-1',
        'q-1',
        { score: 10, isCorrect: true },
        { id: 'user-1', role: 'TEACHER' }
      );

      expect(prisma.examAnswer.update).toHaveBeenCalledWith({
        where: { attemptId_questionId: { attemptId: 'attempt-1', questionId: 'q-1' } },
        data: expect.any(Object),
      });

      expect(prisma.examAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: { score: expect.anything(), status: 'COMPLETED' },
      });
      expect(result.score).toBe(30);
    });

    it('should calculate topic mastery analytics correctly', async () => {
      const mockExam = {
        id: 'exam-1',
        questionBank: {
          questions: [
            {
              id: 'q1',
              points: 10,
              content: 'Question 1 content',
            },
            {
              id: 'q2',
              points: 10,
              content: 'Question 2 content',
            },
          ],
        },
        attempts: [
          {
            id: 'att1',
            status: 'COMPLETED',
            answers: [
              {
                questionId: 'q1',
                score: 10,
                question: {
                  points: 10,
                  learningObjective: { id: 'tp1', code: 'TP1', description: 'Desc' },
                },
              },
              {
                questionId: 'q2',
                score: 5,
                question: {
                  points: 10,
                  learningObjective: { id: 'tp1', code: 'TP1', description: 'Desc' },
                },
              },
            ],
          },
        ],
      };

      vi.mocked(prisma.exam.findUnique).mockResolvedValue(mockExam as any);

      const result = await CBTService.getTopicMasteryAnalytics('exam-1');

      expect(result).not.toBeNull();
      expect(result!.items).toHaveLength(2);
      expect(result!._meta.truncated).toBe(false);
      // Sorted weakest first: q2 (50%) before q1 (100%)
      expect(result!.items[0].objectiveId).toBe('q2');
      expect(result!.items[0].totalPoints).toBe(10); // 10 points * 1 attempt
      expect(result!.items[0].earnedPoints).toBe(5);
      expect(result!.items[0].masteryLevel).toBe(50);
      expect(result!.items[1].objectiveId).toBe('q1');
      expect(result!.items[1].totalPoints).toBe(10);
      expect(result!.items[1].earnedPoints).toBe(10);
      expect(result!.items[1].masteryLevel).toBe(100);
    });

    it('should include NEEDS_REVIEW attempts in topic mastery (MC/TF answers already graded)', async () => {
      const mockExam = {
        id: 'exam-2',
        questionBank: {
          questions: [
            { id: 'q1', points: 10, content: 'MC Question' },
            { id: 'q2', points: 20, content: 'Essay Question' },
          ],
        },
        attempts: [
          {
            id: 'att1',
            status: 'NEEDS_REVIEW',
            answers: [
              {
                questionId: 'q1',
                score: 10,
                question: {
                  points: 10,
                  learningObjective: { id: 'tp1', code: 'TP1', description: 'Desc' },
                },
              }, // MC auto-graded
              {
                questionId: 'q2',
                score: null,
                question: {
                  points: 20,
                  learningObjective: { id: 'tp2', code: 'TP2', description: 'Desc' },
                },
              }, // Essay ungraded
            ],
          },
          {
            id: 'att2',
            status: 'COMPLETED',
            answers: [
              {
                questionId: 'q1',
                score: 10,
                question: {
                  points: 10,
                  learningObjective: { id: 'tp1', code: 'TP1', description: 'Desc' },
                },
              },
              {
                questionId: 'q2',
                score: 15,
                question: {
                  points: 20,
                  learningObjective: { id: 'tp2', code: 'TP2', description: 'Desc' },
                },
              },
            ],
          },
        ],
      };

      vi.mocked(prisma.exam.findUnique).mockResolvedValue(mockExam as any);

      const result = await CBTService.getTopicMasteryAnalytics('exam-2');

      expect(result).not.toBeNull();
      expect(result!.items).toHaveLength(2);
      // q1: both attempts graded → 2 graded, 20 earned / 20 total = 100%
      const q1 = result!.items.find((i: any) => i.objectiveId === 'q1');
      expect(q1!.earnedPoints).toBe(20);
      expect(q1!.totalPoints).toBe(20);
      expect(q1!.masteryLevel).toBe(100);
      // q2: only COMPLETED attempt has score → 1 graded, 15 earned / 20 total = 75%
      const q2 = result!.items.find((i: any) => i.objectiveId === 'q2');
      expect(q2!.earnedPoints).toBe(15);
      expect(q2!.totalPoints).toBe(20);
      expect(q2!.masteryLevel).toBe(75);
    });
  });

  describe('Exam Attempts', () => {
    it('should start a new attempt if not exists', async () => {
      vi.mocked(prisma.exam.findUnique).mockResolvedValue({
        id: 'exam-1',
        questionBank: {},
      } as any);

      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.examAttempt.create).mockResolvedValue({ id: 'attempt-1' } as any);

      await CBTService.startExamAttempt('exam-1', 'std-1');

      expect(prisma.examAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          examId: 'exam-1',
          studentId: 'std-1',
          status: 'IN_PROGRESS',
        }),
      });
    });

    it('should handle concurrent startExamAttempt (P2002) gracefully', async () => {
      vi.mocked(prisma.exam.findUnique).mockResolvedValue({
        id: 'exam-1',
        questionBank: {},
      } as any);

      vi.mocked(prisma.examAttempt.findUnique)
        .mockResolvedValueOnce(null) // First call: no existing attempt
        .mockResolvedValueOnce({ id: 'attempt-1', status: 'IN_PROGRESS' } as any); // Retry after P2002

      const p2002Error = new Error('Unique constraint failed') as any;
      p2002Error.code = 'P2002';
      vi.mocked(prisma.examAttempt.create).mockRejectedValue(p2002Error);

      const result = await CBTService.startExamAttempt('exam-1', 'std-1');

      expect(result).toEqual({ id: 'attempt-1', status: 'IN_PROGRESS' });
    });

    it('should reject submitAnswer when exam has no question bank', async () => {
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: { questionBankId: null },
      } as any);

      await expect(CBTService.submitAnswer('attempt-1', 'q-1', 'opt-B', 'std-1')).rejects.toThrow(
        'not configured for CBT'
      );
    });

    it('should submit an answer using upsert', async () => {
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: { questionBankId: 'bank-1' },
      } as any);
      vi.mocked(prisma.question.findUnique).mockResolvedValue({
        id: 'q-1',
        bankId: 'bank-1',
        type: 'MULTIPLE_CHOICE',
        options: [{ id: 'opt-B', text: 'B' }],
      } as any);
      vi.mocked(prisma.examAnswer.upsert).mockResolvedValue({ id: 'ans-1' } as any);

      await CBTService.submitAnswer('attempt-1', 'q-1', 'opt-B', 'std-1');

      expect(prisma.examAnswer.upsert).toHaveBeenCalledWith({
        where: {
          attemptId_questionId: { attemptId: 'attempt-1', questionId: 'q-1' },
        },
        create: expect.objectContaining({ answer: 'opt-B' }),
        update: { answer: 'opt-B' },
      });
    });

    it('menyimpan pilihan ganda sebagai id opsi, bukan muatan mentah', async () => {
      // Klien lama dapat mengirim objek opsi sekaligus catatan bebas. Yang
      // disimpan hanya id opsi; sisa muatan tidak boleh sampai ke pemeriksa.
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: { questionBankId: 'bank-1' },
      } as any);
      vi.mocked(prisma.question.findUnique).mockResolvedValue({
        id: 'q-1',
        bankId: 'bank-1',
        type: 'MULTIPLE_CHOICE',
        options: [{ id: 'opt-B', text: 'B' }],
      } as any);
      vi.mocked(prisma.examAnswer.upsert).mockResolvedValue({ id: 'ans-1' } as any);

      await CBTService.submitAnswer(
        'attempt-1',
        'q-1',
        { id: 'opt-B', catatan: 'nama saya Budi' },
        'std-1'
      );

      expect(prisma.examAnswer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ answer: 'opt-B' }),
          update: { answer: 'opt-B' },
        })
      );
    });

    it('menyimpan jawaban kosong non-esai sebagai NULL, bukan string kosong', async () => {
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: { questionBankId: 'bank-1' },
      } as any);
      vi.mocked(prisma.question.findUnique).mockResolvedValue({
        id: 'q-1',
        bankId: 'bank-1',
        type: 'MULTIPLE_CHOICE',
        options: [{ id: 'opt-B', text: 'B' }],
      } as any);
      vi.mocked(prisma.examAnswer.upsert).mockResolvedValue({ id: 'ans-1' } as any);

      await CBTService.submitAnswer('attempt-1', 'q-1', '', 'std-1');

      expect(prisma.examAnswer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ answer: 'DbNull' }),
          update: { answer: 'DbNull' },
        })
      );
    });

    it('menolak jawaban pilihan ganda yang bukan opsi soal', async () => {
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: { questionBankId: 'bank-1' },
      } as any);
      vi.mocked(prisma.question.findUnique).mockResolvedValue({
        id: 'q-1',
        bankId: 'bank-1',
        type: 'MULTIPLE_CHOICE',
        options: [{ id: 'opt-B', text: 'B' }],
      } as any);

      const error = await CBTService.submitAnswer(
        'attempt-1',
        'q-1',
        'nama saya Budi',
        'std-1'
      ).then(
        () => null,
        (err: Error) => err
      );

      expect(error?.message).toContain('harus berupa id salah satu opsi');
      // `errorHandler` mencatat pesan galat; teks kiriman tidak boleh ikut.
      expect(error?.message).not.toContain('nama saya Budi');
      expect(prisma.examAnswer.upsert).not.toHaveBeenCalled();
    });

    it('menjelaskan soal pilihan ganda yang belum memiliki opsi', async () => {
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: { questionBankId: 'bank-1' },
      } as any);
      vi.mocked(prisma.question.findUnique).mockResolvedValue({
        id: 'q-1',
        bankId: 'bank-1',
        type: 'MULTIPLE_CHOICE',
        options: [],
      } as any);

      const error = await CBTService.submitAnswer('attempt-1', 'q-1', 'opt-B', 'std-1').then(
        () => null,
        (err: Error) => err
      );

      expect(error?.message).toBe('Soal ini belum memiliki opsi jawaban.');
      expect(prisma.examAnswer.upsert).not.toHaveBeenCalled();
    });

    it('menyimpan jawaban benar-salah sebagai true/false kanonis', async () => {
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: { questionBankId: 'bank-1' },
      } as any);
      vi.mocked(prisma.question.findUnique).mockResolvedValue({
        id: 'q-1',
        bankId: 'bank-1',
        type: 'TRUE_FALSE',
        options: null,
      } as any);
      vi.mocked(prisma.examAnswer.upsert).mockResolvedValue({ id: 'ans-1' } as any);

      await CBTService.submitAnswer('attempt-1', 'q-1', true, 'std-1');

      expect(prisma.examAnswer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { answer: 'true' } })
      );
    });

    it('menilai soal benar-salah yang kuncinya boolean JSON', async () => {
      // Regresi: penilai lama membandingkan JSON.stringify kedua sisi, sedangkan
      // klien web selalu mengirim string ("true"/"false"). Kunci boolean `true`
      // — bentuk paling wajar untuk kolom Json — membuat SETIAP siswa salah,
      // tanpa pesan apa pun, dan nilainya kini menyeberang ke buku nilai.
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-tf',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: {
          questionBank: {
            questions: [
              { id: 'q-1', type: 'TRUE_FALSE', answerKey: true, points: 10 },
              { id: 'q-2', type: 'TRUE_FALSE', answerKey: false, points: 10 },
            ],
          },
        },
        answers: [
          { id: 'ans-1', questionId: 'q-1', answer: 'true' }, // benar
          { id: 'ans-2', questionId: 'q-2', answer: 'true' }, // salah
        ],
      } as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({} as any);

      await CBTService.finishExamAttempt('attempt-tf', 'std-1');

      expect(prisma.examAnswer.update).toHaveBeenCalledWith({
        where: { id: 'ans-1' },
        data: { isCorrect: true, score: 10 },
      });
      expect(prisma.examAnswer.update).toHaveBeenCalledWith({
        where: { id: 'ans-2' },
        data: { isCorrect: false, score: 0 },
      });
    });

    it('waktu habis: jawaban yang sudah masuk dinilai, bukan hangus', async () => {
      // Perilaku lama melempar di sini, sehingga baris exam_answers tetap ada di
      // basis data tetapi tidak pernah dinilai dan tidak ada Grade yang terbit —
      // koneksi yang putus di menit terakhir memusnahkan seluruh ujian.
      const startedAt = new Date(Date.now() - 120 * 60 * 1000); // 120 menit lalu
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-late',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        startedAt,
        score: null,
        exam: {
          duration: 60,
          questionBank: {
            questions: [{ id: 'q-1', type: 'MULTIPLE_CHOICE', answerKey: 'opt-A', points: 10 }],
          },
        },
        answers: [{ id: 'ans-1', questionId: 'q-1', answer: 'opt-A' }],
      } as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({} as any);

      await expect(CBTService.finishExamAttempt('attempt-late', 'std-1')).resolves.toBeDefined();

      expect(prisma.examAnswer.update).toHaveBeenCalledWith({
        where: { id: 'ans-1' },
        data: { isCorrect: true, score: 10 },
      });
      expect(prisma.examAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-late' },
        data: expect.objectContaining({ status: 'COMPLETED', score: expect.anything() }),
      });
    });

    it('waktu habis dicatat sebagai ditutup sistem, bukan dikumpulkan siswa', async () => {
      const startedAt = new Date(Date.now() - 120 * 60 * 1000);
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-late-2',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        startedAt,
        score: null,
        exam: {
          duration: 60,
          questionBank: { questions: [] },
        },
        answers: [],
      } as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({} as any);

      await CBTService.finishExamAttempt('attempt-late-2', 'std-1');

      expect(prisma.examSecurityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attemptId: 'attempt-late-2',
          type: 'TIME_EXPIRED_AUTO_SUBMIT',
        }),
      });
    });

    it('attempt yang dikumpulkan tepat waktu tidak menulis log waktu habis', async () => {
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-ontime',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        score: null,
        exam: { duration: 60, questionBank: { questions: [] } },
        answers: [],
      } as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({} as any);

      await CBTService.finishExamAttempt('attempt-ontime', 'std-1');

      expect(prisma.examSecurityLog.create).not.toHaveBeenCalled();
    });

    it('attempt EXPIRED lama yang belum bernilai masih bisa dinilai', async () => {
      // Baris yang ditinggalkan perilaku lama: EXPIRED dengan score null adalah
      // jalan buntu — memanggil submit lagi pun melempar. Sekarang ia dinilai.
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue({
        id: 'attempt-stale',
        studentId: 'std-1',
        status: 'EXPIRED',
        score: null,
        startedAt: new Date(Date.now() - 120 * 60 * 1000),
        exam: {
          duration: 60,
          questionBank: {
            questions: [{ id: 'q-1', type: 'MULTIPLE_CHOICE', answerKey: 'opt-A', points: 10 }],
          },
        },
        answers: [{ id: 'ans-1', questionId: 'q-1', answer: 'opt-A' }],
      } as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({} as any);

      await CBTService.finishExamAttempt('attempt-stale', 'std-1');

      expect(prisma.examAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-stale' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      });
    });

    it('should grade and finish exam attempt atomically', async () => {
      const attemptData = {
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: {
          questionBank: {
            questions: [
              { id: 'q-1', type: 'MULTIPLE_CHOICE', answerKey: 'opt-A', points: 10 },
              { id: 'q-2', type: 'MULTIPLE_CHOICE', answerKey: 'opt-C', points: 10 },
            ],
          },
        },
        answers: [
          { id: 'ans-1', questionId: 'q-1', answer: 'opt-A' }, // correct
          { id: 'ans-2', questionId: 'q-2', answer: 'opt-B' }, // wrong
        ],
      };

      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue(attemptData as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({} as any);

      // The transaction now includes both answer grading and attempt status update
      vi.mocked(prisma.$transaction).mockImplementation((promises) => {
        return Promise.resolve(promises) as any;
      });

      await CBTService.finishExamAttempt('attempt-1', 'std-1');

      // Attempt update is now inside the transaction batch
      expect(prisma.examAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          score: expect.anything(),
        }),
      });

      // q-1 correct, q-2 wrong
      expect(prisma.examAnswer.update).toHaveBeenCalledWith({
        where: { id: 'ans-1' },
        data: { isCorrect: true, score: 10 },
      });
      expect(prisma.examAnswer.update).toHaveBeenCalledWith({
        where: { id: 'ans-2' },
        data: { isCorrect: false, score: 0 },
      });

      // Re-fetches the attempt after transaction with safe select on questions
      expect(prisma.examAttempt.findUnique).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        include: {
          answers: true,
          exam: {
            include: {
              questionBank: {
                include: {
                  questions: {
                    select: {
                      id: true,
                      type: true,
                      content: true,
                      options: true,
                      points: true,
                    },
                    orderBy: { order: 'asc' },
                  },
                },
              },
            },
          },
        },
      });
    });

    it('should create answer records for unanswered essay questions and set NEEDS_REVIEW', async () => {
      const attemptData = {
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        exam: {
          questionBank: {
            questions: [
              { id: 'q-1', type: 'MULTIPLE_CHOICE', answerKey: 'opt-A', points: 10 },
              { id: 'q-2', type: 'ESSAY', answerKey: null, points: 20 },
            ],
          },
        },
        answers: [
          { id: 'ans-1', questionId: 'q-1', answer: 'opt-A' }, // answered MC
          // q-2 (ESSAY) not answered
        ],
      };

      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue(attemptData as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({} as any);
      vi.mocked(prisma.examAnswer.upsert).mockResolvedValue({ id: 'ans-2' } as any);

      // The transaction now includes both answer grading and attempt status update
      vi.mocked(prisma.$transaction).mockImplementation((promises) => {
        return Promise.resolve(promises) as any;
      });

      await CBTService.finishExamAttempt('attempt-1', 'std-1');

      // Should upsert an empty answer record for the unanswered essay
      expect(prisma.examAnswer.upsert).toHaveBeenCalledWith({
        where: {
          attemptId_questionId: { attemptId: 'attempt-1', questionId: 'q-2' },
        },
        create: {
          attemptId: 'attempt-1',
          questionId: 'q-2',
          answer: 'JsonNull',
          isCorrect: null,
          score: null,
        },
        update: {},
      });

      // Status should be NEEDS_REVIEW because of essay question
      expect(prisma.examAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({
          status: 'NEEDS_REVIEW',
          score: expect.anything(), // Decimal(10) — only MC score
        }),
      });
    });

    it('should randomize question and option order deterministically per attempt', async () => {
      const mockAttempt = {
        id: 'attempt-123',
        studentId: 'std-1',
        exam: {
          questionBank: {
            questions: [
              { id: 'q1', content: 'Q1', options: [{ id: 'opt1' }, { id: 'opt2' }], order: 1 },
              { id: 'q2', content: 'Q2', options: [{ id: 'opt3' }, { id: 'opt4' }], order: 2 },
              { id: 'q3', content: 'Q3', options: [], order: 3 },
            ],
          },
        },
      };

      vi.mocked(prisma.examAttempt.findUnique).mockImplementation(
        () => Promise.resolve(JSON.parse(JSON.stringify(mockAttempt))) as any
      );

      const attempt1 = await CBTService.getAttempt('attempt-123', 'std-1');
      const questions1 = attempt1.exam?.questionBank?.questions ?? [];

      // Re-fetching same attempt should return identical randomized order
      const attempt2 = await CBTService.getAttempt('attempt-123', 'std-1');
      const questions2 = attempt2.exam?.questionBank?.questions ?? [];

      expect(questions1).toHaveLength(3);
      expect(questions1.map((q: any) => q.id)).toEqual(questions2.map((q: any) => q.id));
    });

    it('should record security log events (anti-cheating tab switches)', async () => {
      const mockStudent = { id: 'std-1', userId: 'user-std-1' };
      const mockAttempt = {
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        tabSwitchCount: 1,
      };

      vi.mocked(prisma.student.findUnique).mockResolvedValue(mockStudent as any);
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue(mockAttempt as any);
      vi.mocked(prisma.examSecurityLog.create).mockResolvedValue({
        id: 'log-1',
        attemptId: 'attempt-1',
        type: 'TAB_SWITCH',
        details: { note: 'Minimizing window' },
        createdAt: new Date(),
      } as any);

      await CBTService.recordSecurityLog('attempt-1', 'user-std-1', {
        type: 'TAB_SWITCH',
        details: { note: 'Minimizing window' },
      });

      expect(prisma.examSecurityLog.create).toHaveBeenCalledWith({
        data: {
          attemptId: 'attempt-1',
          type: 'TAB_SWITCH',
          details: { note: 'Minimizing window' },
        },
      });

      expect(prisma.examAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: {
          tabSwitchCount: { increment: 1 },
        },
      });
    });

    it('should reject recordSecurityLog if attempt is not IN_PROGRESS', async () => {
      const mockStudent = { id: 'std-1', userId: 'user-std-1' };
      const completedAttempt = {
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'COMPLETED',
      };

      vi.mocked(prisma.student.findUnique).mockResolvedValue(mockStudent as any);
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue(completedAttempt as any);

      await expect(
        CBTService.recordSecurityLog('attempt-1', 'user-std-1', {
          type: 'TAB_SWITCH',
          details: { note: 'Late event after completion' },
        })
      ).rejects.toThrow('Cannot record security events');
    });

    it('jawaban yang terlambat ditolak, tetapi ujiannya ditutup dan dinilai', async () => {
      // Uji ini dulu menuntut `status: 'EXPIRED'` — yaitu persis perilaku yang
      // harus berubah. EXPIRED tanpa nilai adalah jalan buntu: jawaban yang
      // sempat masuk tidak pernah dinilai dan tidak ada Grade yang terbit.
      // Yang benar: jawaban terlambat ini ditolak, dan lembar jawabannya ditutup
      // lalu dinilai apa adanya.
      const pastTime = new Date(Date.now() - 90 * 60 * 1000); // 90 menit lalu, ujian 60 menit
      const lateAttempt = {
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'IN_PROGRESS',
        startedAt: pastTime,
        score: null,
        exam: {
          questionBankId: 'bank-1',
          duration: 60,
          questionBank: {
            questions: [{ id: 'q-1', type: 'MULTIPLE_CHOICE', answerKey: 'opt-A', points: 10 }],
          },
        },
        answers: [{ id: 'ans-1', questionId: 'q-1', answer: 'opt-A' }],
      };
      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue(lateAttempt as any);
      vi.mocked(prisma.examAttempt.update).mockResolvedValue({} as any);

      await expect(CBTService.submitAnswer('attempt-1', 'q-1', 'opt-A', 'std-1')).rejects.toThrow(
        'Waktu pengerjaan ujian telah habis.'
      );

      // Jawaban yang sudah tersimpan tetap dinilai…
      expect(prisma.examAnswer.update).toHaveBeenCalledWith({
        where: { id: 'ans-1' },
        data: { isCorrect: true, score: 10 },
      });
      // …dan attempt-nya selesai dengan nilai, bukan ditinggalkan EXPIRED kosong.
      expect(prisma.examAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({ status: 'COMPLETED', score: expect.anything() }),
      });
      // Jawaban terlambatnya sendiri tidak ikut tersimpan.
      expect(prisma.examAnswer.upsert).not.toHaveBeenCalled();
    });

    it('should NOT expire an already COMPLETED attempt during late retry of finishExamAttempt', async () => {
      const pastTime = new Date(Date.now() - 90 * 60 * 1000); // 90 mins ago
      const completedAttempt = {
        id: 'attempt-1',
        studentId: 'std-1',
        status: 'COMPLETED',
        score: 100,
        startedAt: pastTime,
        exam: { id: 'exam-1', teacherId: 't-1', duration: 60, questionBank: { questions: [] } },
        answers: [],
      };

      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValueOnce(completedAttempt as any);

      const result = await CBTService.finishExamAttempt('attempt-1', 'std-1');

      expect(result.status).toBe('COMPLETED');
      expect(prisma.examAttempt.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) })
      );
    });

    it('should calculate percentage and letter grade from question bank total points when upserting grade', async () => {
      vi.mocked(prisma.grade.upsert).mockClear();

      const mockAttemptForSync = {
        id: 'attempt-sync-1',
        studentId: 'std-1',
        examId: 'exam-1',
        score: 50, // student got 50 points
        status: 'COMPLETED',
        exam: {
          id: 'exam-1',
          maxScore: 100, // exam maxScore is 100, but question bank points total 50
          subjectId: 'sub-1',
          academicYearId: 'ay-1',
          teacherId: 't-1',
          title: 'Math Exam',
          questionBank: {
            questions: [
              { points: 25 },
              { points: 25 }, // total possible points = 50
            ],
          },
        },
      };

      vi.mocked(prisma.examAttempt.findUnique).mockImplementation((args: any) => {
        if (args?.where?.id === 'attempt-sync-1') {
          return Promise.resolve(mockAttemptForSync) as any;
        }
        return Promise.resolve(null) as any;
      });
      vi.mocked(prisma.teacher.findUnique).mockResolvedValue({ userId: 'user-t-1' } as any);
      vi.mocked(prisma.grade.upsert).mockResolvedValue({ id: 'grade-1' } as any);

      await CBTService.syncGradeToAcademicGradebook('attempt-sync-1');

      // 50 out of 50 total question points = 100% -> Letter grade A!
      expect(prisma.grade.upsert).toHaveBeenCalledWith({
        where: { studentId_examId: { studentId: 'std-1', examId: 'exam-1' } },
        create: expect.objectContaining({
          letterGrade: 'A',
        }),
        update: expect.objectContaining({
          letterGrade: 'A',
          score: 50,
          percentage: expect.any(Object),
          gradedAt: expect.any(Date),
        }),
      });
    });

    it('should refresh an existing EXAM grade even without forceUpdate (non-essay exam)', async () => {
      vi.mocked(prisma.grade.upsert).mockClear();

      const mockAttemptForSync = {
        id: 'attempt-sync-existing',
        studentId: 'std-1',
        examId: 'exam-1',
        score: 40,
        status: 'COMPLETED',
        exam: {
          id: 'exam-1',
          maxScore: 100,
          subjectId: 'sub-1',
          academicYearId: 'ay-1',
          teacherId: 't-1',
          title: 'Math Exam',
          questionBank: {
            questions: [{ points: 25 }, { points: 25 }], // total possible points = 50
          },
        },
      };

      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue(mockAttemptForSync as any);
      vi.mocked(prisma.teacher.findUnique).mockResolvedValue({ userId: 'user-t-1' } as any);
      vi.mocked(prisma.grade.upsert).mockResolvedValue({ id: 'grade-1' } as any);

      await CBTService.syncGradeToAcademicGradebook('attempt-sync-existing');

      // 40 / 50 = 80% -> updates the already-present grade row with the new score
      const callArgs = vi.mocked(prisma.grade.upsert).mock.calls[0] as any;
      expect(callArgs[0].where).toEqual({
        studentId_examId: { studentId: 'std-1', examId: 'exam-1' },
      });
      expect(callArgs[0].update).toEqual(
        expect.objectContaining({
          score: 40,
          letterGrade: 'B',
          gradedAt: expect.any(Date),
        })
      );
      // note is only set in the forceUpdate (post-essay-grading) path
      expect(callArgs[0].update.notes).toBeUndefined();
    });

    it('should update Grade when forceUpdate is true after essay grading', async () => {
      vi.mocked(prisma.grade.upsert).mockClear();

      const mockAttemptForSync = {
        id: 'attempt-sync-essay',
        studentId: 'std-1',
        examId: 'exam-1',
        score: 45, // updated score 45/50
        status: 'COMPLETED',
        exam: {
          id: 'exam-1',
          maxScore: 50,
          subjectId: 'sub-1',
          academicYearId: 'ay-1',
          teacherId: 't-1',
          title: 'Math Exam',
          questionBank: {
            questions: [{ points: 25 }, { points: 25 }],
          },
        },
      };

      vi.mocked(prisma.examAttempt.findUnique).mockResolvedValue(mockAttemptForSync as any);
      vi.mocked(prisma.teacher.findUnique).mockResolvedValue({ userId: 'user-t-1' } as any);
      vi.mocked(prisma.grade.upsert).mockResolvedValue({ id: 'grade-1' } as any);

      await CBTService.syncGradeToAcademicGradebook('attempt-sync-essay', { forceUpdate: true });

      // 45 / 50 = 90% -> Letter grade A!
      expect(prisma.grade.upsert).toHaveBeenCalledWith({
        where: { studentId_examId: { studentId: 'std-1', examId: 'exam-1' } },
        create: expect.objectContaining({ letterGrade: 'A' }),
        update: expect.objectContaining({ letterGrade: 'A' }),
      });
    });

    it('should calculate distractor analysis for multiple choice questions', async () => {
      const mockExam = {
        id: 'exam-1',
        title: 'Exam Title',
        questionBank: {
          questions: [
            {
              id: 'q1',
              type: 'MULTIPLE_CHOICE',
              content: 'What is 2+2?',
              options: [
                { id: 'opt1', text: '4' },
                { id: 'opt2', text: '5' },
              ],
            },
          ],
        },
        attempts: [
          {
            id: 'a1',
            status: 'COMPLETED',
            score: 100,
            answers: [{ questionId: 'q1', answer: 'opt1', score: 10, isCorrect: true }],
          },
          {
            id: 'a2',
            status: 'COMPLETED',
            score: 0,
            answers: [{ questionId: 'q1', answer: 'opt2', score: 0, isCorrect: false }],
          },
        ],
      };

      vi.mocked(prisma.exam.findUnique).mockResolvedValue(mockExam as any);

      const insights = await CBTService.getExamDifficultyInsights('exam-1');

      expect(insights).not.toBeNull();
      const qInsight = insights!.questionInsights[0];
      expect(qInsight.distractorAnalysis).toBeDefined();
      expect(qInsight.distractorAnalysis).toHaveLength(2);
      expect(qInsight.distractorAnalysis![0]).toEqual(
        expect.objectContaining({ count: 1, percentage: 50 })
      );
    });

    it('mengeluarkan jawaban yang opsinya sudah dihapus dari penyebut distribusi', async () => {
      // Guru dapat menghapus opsi setelah jawaban dinilai. ERASURE hanya
      // mengosongkan isi jawaban itu dan mempertahankan skornya, jadi
      // distribusi harus memakai penyebut pilihan yang masih dapat dipetakan —
      // bukan `totalGraded`, yang masih memuat jawaban berskor tersebut.
      const mockExam = {
        id: 'exam-1',
        title: 'Exam Title',
        questionBank: {
          questions: [
            {
              id: 'q1',
              type: 'MULTIPLE_CHOICE',
              content: 'What is 2+2?',
              options: [
                { id: 'opt1', text: '4' },
                { id: 'opt2', text: '5' },
              ],
            },
          ],
        },
        attempts: [
          {
            id: 'a1',
            status: 'COMPLETED',
            score: 10,
            answers: [{ questionId: 'q1', answer: 'opt-old', score: 10, isCorrect: true }],
          },
          {
            id: 'a2',
            status: 'COMPLETED',
            score: 0,
            answers: [{ questionId: 'q1', answer: 'opt1', score: 0, isCorrect: false }],
          },
        ],
      };

      vi.mocked(prisma.exam.findUnique).mockResolvedValue(mockExam as any);

      const insights = await CBTService.getExamDifficultyInsights('exam-1');
      const qInsight = insights!.questionInsights[0];

      expect(qInsight.totalGraded).toBe(2);
      expect(qInsight.distractorAnalysis).toEqual([
        expect.objectContaining({ count: 1, percentage: 100 }),
        expect.objectContaining({ count: 0, percentage: 0 }),
      ]);
    });

    it('tidak menggandakan persentase ketika id opsi duplikat', async () => {
      // Formulir dapat menghasilkan dua opsi ber-id sama setelah guru menghapus
      // satu opsi lalu menambah opsi baru. Keduanya tidak boleh menampilkan
      // jawaban yang sama sebagai 100%.
      const mockExam = {
        id: 'exam-1',
        title: 'Exam Title',
        questionBank: {
          questions: [
            {
              id: 'q1',
              type: 'MULTIPLE_CHOICE',
              content: 'What is 2+2?',
              options: [
                { id: 'opt-A', text: '1' },
                { id: 'opt-C', text: '3' },
                { id: 'opt-D', text: '4' },
                { id: 'opt-D', text: '4 (lama)' },
              ],
            },
          ],
        },
        attempts: [
          {
            id: 'a1',
            status: 'COMPLETED',
            score: 10,
            answers: [{ questionId: 'q1', answer: 'opt-D', score: 10, isCorrect: true }],
          },
        ],
      };

      vi.mocked(prisma.exam.findUnique).mockResolvedValue(mockExam as any);

      const insights = await CBTService.getExamDifficultyInsights('exam-1');
      const analysis = insights!.questionInsights[0].distractorAnalysis!;

      expect(analysis).toHaveLength(3);
      const dRows = analysis.filter((row) =>
        (row.options as Array<{ id?: string }>).some((opt) => opt.id === 'opt-D')
      );
      expect(dRows).toHaveLength(1);
      expect(dRows[0]).toEqual(
        expect.objectContaining({
          // Form santri hanya mengirim id. Karena dua teks berbagi id, tidak
          // ada satu teks yang boleh diklaim memiliki jumlah itu.
          optionId: 'opt-D',
          option: null,
          ambiguous: true,
          options: [
            expect.objectContaining({ text: '4' }),
            expect.objectContaining({ text: '4 (lama)' }),
          ],
          count: 1,
          percentage: 100,
        })
      );
      expect(analysis.reduce((sum, row) => sum + row.percentage, 0)).toBe(100);
      expect(analysis.filter((row) => !row.ambiguous)).toHaveLength(2);
    });
  });
});
