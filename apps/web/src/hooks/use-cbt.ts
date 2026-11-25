import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "@/lib/api";
import {
  examDifficultyInsightsSchema,
  SecurityEventType,
  type ExamDifficultyInsights,
} from "@cipansor/shared";

// Types
export { QuestionType } from "@cipansor/shared";
export type {
  Question,
  QuestionBank,
  ExamAttempt,
  ExamAnswer,
  ExamSecurityLog,
  ExamDifficultyInsights,
} from "@cipansor/shared";

// Hooks

export const useQuestionBanks = (params?: any) => {
  return useQuery({
    queryKey: ["question-banks", params],
    queryFn: async () => {
      const { data } = await api.get("/cbt/banks", { params });
      return data;
    },
  });
};

export const useRecordSecurityLog = () => {
  return useMutation({
    mutationFn: async ({
      attemptId,
      eventType,
      details,
    }: {
      attemptId: string;
      eventType: SecurityEventType;
      // Structured, matching the JSONB column; `{ note }` is the usual shape for
      // something a person will read.
      details?: Record<string, unknown> | null;
    }) => {
      const { data } = await api.post(
        `/cbt/attempts/${attemptId}/security-log`,
        {
          eventType,
          details,
        },
      );
      return data.data;
    },
  });
};

// Exam Scheduling

export const useExams = (params?: any) => {
  return useQuery({
    queryKey: ["cbt-exams", params],
    queryFn: async () => {
      const { data } = await api.get("/cbt/exams", { params });
      return data;
    },
  });
};

export const useCreateExam = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const { data: res } = await api.post("/cbt/exams", data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cbt-exams"] });
    },
  });
};

export const useExamMonitoring = (examId: string) => {
  return useQuery({
    queryKey: ["exam-monitoring", examId],
    queryFn: async () => {
      const { data } = await api.get(`/cbt/exams/${examId}/monitoring`);
      return data.data;
    },
    enabled: !!examId,
  });
};

export const useTopicMastery = (examId: string) => {
  return useQuery({
    queryKey: ["exam-topic-mastery", examId],
    queryFn: async () => {
      try {
        const { data } = await api.get(`/cbt/exams/${examId}/topic-mastery`, {
          skipErrorToastForStatus: [404],
        });
        return {
          items: data.data,
          topicMastery: data.topicMastery,
          _meta: data._meta,
        };
      } catch (error) {
        // An exam without a question bank has no topic mastery; that is an
        // empty section, not a user-facing error.
        if (
          (error as { response?: { status?: number } }).response?.status === 404
        ) {
          return null;
        }
        throw error;
      }
    },
    enabled: !!examId,
  });
};

export const useExamDifficultyInsights = (examId: string) => {
  return useQuery({
    queryKey: ["exam-difficulty-insights", examId],
    queryFn: async (): Promise<ExamDifficultyInsights | null> => {
      try {
        const { data } = await api.get<ApiResponse<unknown>>(
          `/cbt/exams/${examId}/difficulty-insights`,
          { skipErrorToastForStatus: [404] },
        );
        if (data.data == null) return null;
        return examDifficultyInsightsSchema.parse(data.data);
      } catch (error) {
        // The controller answers 404 when the exam has no question bank or no
        // analysis yet; that is an empty state, not a parse failure.
        if (
          (error as { response?: { status?: number } }).response?.status === 404
        ) {
          return null;
        }
        throw error;
      }
    },
    enabled: !!examId,
  });
};

// Teacher Grading

export const useAttemptGrading = (attemptId: string) => {
  return useQuery({
    queryKey: ["attempt-grading", attemptId],
    queryFn: async () => {
      const { data } = await api.get(`/cbt/attempts/${attemptId}/grading`);
      return data.data;
    },
    enabled: !!attemptId,
  });
};

export const useGradeAnswer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      attemptId,
      questionId,
      score,
      isCorrect,
    }: {
      attemptId: string;
      questionId: string;
      score: number;
      isCorrect: boolean;
    }) => {
      const { data } = await api.post(`/cbt/attempts/${attemptId}/grade`, {
        questionId,
        score,
        isCorrect,
      });
      return data.data;
    },
    onSuccess: (_, { attemptId }) => {
      queryClient.invalidateQueries({
        queryKey: ["attempt-grading", attemptId],
      });
    },
  });
};

export const useQuestionBank = (id: string) => {
  return useQuery({
    queryKey: ["question-bank", id],
    queryFn: async () => {
      const { data } = await api.get(`/cbt/banks/${id}`);
      return data.data;
    },
    enabled: !!id,
  });
};

export const useCreateQuestionBank = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const { data: res } = await api.post("/cbt/banks", data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-banks"] });
    },
  });
};

export const useDeleteQuestionBank = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/cbt/banks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-banks"] });
    },
  });
};

// Questions

export const useAddQuestion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bankId, data }: { bankId: string; data: any }) => {
      const { data: res } = await api.post(
        `/cbt/banks/${bankId}/questions`,
        data,
      );
      return res.data;
    },
    onSuccess: (_, { bankId }) => {
      queryClient.invalidateQueries({ queryKey: ["question-bank", bankId] });
    },
  });
};

export const useUpdateQuestion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bankId,
      questionId,
      data,
    }: {
      bankId: string;
      questionId: string;
      data: any;
    }) => {
      const { data: res } = await api.put(
        `/cbt/banks/${bankId}/questions/${questionId}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_, { bankId }) => {
      queryClient.invalidateQueries({ queryKey: ["question-bank", bankId] });
    },
  });
};

export const useDeleteQuestion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bankId,
      questionId,
    }: {
      bankId: string;
      questionId: string;
    }) => {
      await api.delete(`/cbt/banks/${bankId}/questions/${questionId}`);
    },
    onSuccess: (_, { bankId }) => {
      queryClient.invalidateQueries({ queryKey: ["question-bank", bankId] });
    },
  });
};

// Student Exam

export const useStartExam = () => {
  return useMutation({
    mutationFn: async (examId: string) => {
      const { data } = await api.post(`/cbt/exams/${examId}/start`);
      return data.data;
    },
  });
};

export const useExamAttempt = (attemptId: string) => {
  return useQuery({
    queryKey: ["exam-attempt", attemptId],
    queryFn: async () => {
      const { data } = await api.get(`/cbt/attempts/${attemptId}`);
      return data.data;
    },
    enabled: !!attemptId,
    // Disable refetch on window focus to avoid resetting UI state unexpectedly
    refetchOnWindowFocus: false,
  });
};

export const useSubmitAnswer = () => {
  return useMutation({
    mutationFn: async ({
      attemptId,
      questionId,
      answer,
    }: {
      attemptId: string;
      questionId: string;
      answer: any;
    }) => {
      await api.post(`/cbt/attempts/${attemptId}/answer`, {
        questionId,
        answer,
      });
    },
  });
};

export const useFinishExam = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { data } = await api.post(`/cbt/attempts/${attemptId}/finish`);
      return data.data;
    },
    onSuccess: (data, attemptId) => {
      queryClient.invalidateQueries({ queryKey: ["exam-attempt", attemptId] });
    },
  });
};
