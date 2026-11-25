"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  useStartExam,
  useExamAttempt,
  useSubmitAnswer,
  useFinishExam,
  useRecordSecurityLog,
  ExamAttempt,
  ExamAnswer,
  Question,
  QuestionType,
} from "@/hooks/use-cbt";
import { useExam } from "@/hooks/use-assessment";
import { getErrorMessage } from "@/lib/api-error";
import {
  Loader2,
  Timer,
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function TakeExamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id: examId } = use(params);
  const { data: exam, isLoading: loadingExam } = useExam(examId);
  const startExam = useStartExam();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const { data: fullAttempt, isLoading: loadingAttempt } = useExamAttempt(
    attemptId ?? "",
  );

  const handleStart = async () => {
    setIsStarting(true);
    try {
      const data = await startExam.mutateAsync(examId);
      setAttemptId(data.id);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  };

  if (loadingExam || (attemptId && loadingAttempt)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!exam) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-96 gap-4">
          <AlertTriangle className="h-12 w-12 text-yellow-500" />
          <h2 className="text-xl font-semibold">Ujian Tidak Ditemukan</h2>
          <Button onClick={() => router.push("/student/exams")}>Kembali</Button>
        </div>
      </MainLayout>
    );
  }

  if (!fullAttempt) {
    return (
      <MainLayout>
        <div className="max-w-2xl mx-auto py-12">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">{exam.title}</CardTitle>
              <CardDescription>{exam.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Durasi</p>
                  <p className="text-xl font-bold">{exam.duration} Menit</p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    Mata Pelajaran
                  </p>
                  <p className="text-xl font-bold">{exam.subject?.name}</p>
                </div>
              </div>

              <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 text-sm text-yellow-800">
                <p className="font-semibold mb-2">Perhatian:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Pastikan koneksi internet stabil.</li>
                  <li>
                    Waktu akan berjalan mundur otomatis setelah tombol Mulai
                    ditekan.
                  </li>
                  <li>Jawaban akan tersimpan otomatis.</li>
                  <li>Jangan me-refresh halaman jika tidak diperlukan.</li>
                </ul>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                size="lg"
                className="w-full"
                onClick={handleStart}
                disabled={isStarting}
              >
                {isStarting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="mr-2 h-4 w-4" />
                )}
                Mulai Kerjakan
              </Button>
            </CardFooter>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return <ExamPlayer attempt={fullAttempt} examDuration={exam.duration} />;
}

function ExamPlayer({
  attempt,
  examDuration,
}: {
  attempt: ExamAttempt;
  examDuration: number;
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [timeLeft, setTimeLeft] = useState(examDuration * 60); // seconds
  const [tabSwitchCount, setTabSwitchCount] = useState(0);

  const submitAnswer = useSubmitAnswer();
  const finishExam = useFinishExam();
  const recordSecurityLog = useRecordSecurityLog();

  const draftStorageKey = `cbt_draft_${attempt.id}`;

  useEffect(() => {
    if (attempt?.exam?.questionBank?.questions) {
      setQuestions(attempt.exam.questionBank.questions);
    }

    if (attempt?.tabSwitchCount) {
      setTabSwitchCount(attempt.tabSwitchCount);
    }

    // Restore initial answers from backend + local draft storage for offline resilience
    const initialAnswers: Record<string, any> = {};
    if (attempt?.answers) {
      attempt.answers.forEach((ans: any) => {
        initialAnswers[ans.questionId] = ans.answer;
      });
    }

    if (typeof window !== "undefined") {
      if (attempt.status !== "IN_PROGRESS") {
        localStorage.removeItem(draftStorageKey);
      } else {
        try {
          const savedDraftRaw = localStorage.getItem(draftStorageKey);
          if (savedDraftRaw) {
            const savedDraft = JSON.parse(savedDraftRaw);
            const draftAnswers = savedDraft.answers || savedDraft;
            const draftTime = savedDraft.timestamp || 0;
            const attemptUpdatedTime = attempt.updatedAt
              ? new Date(attempt.updatedAt).getTime()
              : 0;

            for (const [qId, draftVal] of Object.entries(draftAnswers)) {
              const hasServerAns =
                initialAnswers[qId] !== undefined && initialAnswers[qId] !== "";
              // For questions with NO server answer (hasServerAns == false), always apply local draft.
              // For questions with existing server answer, apply draft only if draft is newer than attempt.updatedAt.
              if (!hasServerAns || draftTime > attemptUpdatedTime) {
                initialAnswers[qId] = draftVal;
              }
            }
          }
        } catch (err) {
          console.error("Failed to load local exam draft", err);
        }
      }
    }
    setAnswers(initialAnswers);

    // Calculate time left based on startedAt
    if (attempt.startedAt) {
      const startTime = new Date(attempt.startedAt).getTime();
      const endTime = startTime + examDuration * 60 * 1000;
      const now = new Date().getTime();
      const diff = Math.floor((endTime - now) / 1000);
      setTimeLeft(diff > 0 ? diff : 0);
    }
  }, [attempt, examDuration, draftStorageKey]);

  const currentQuestion = questions[currentIndex];

  // Keep the latest answers/server answers readable from callbacks without
  // eagerly rebinding effects (used by the finish and timer flows).
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const serverAnswersRef = useRef(attempt.answers);
  useEffect(() => {
    serverAnswersRef.current = attempt.answers;
  }, [attempt.answers]);

  // Track in-flight autosaves so finalization can settle them before grading,
  // preventing a slow autosave request landing after the final answers.
  const pendingSubmitsRef = useRef<Set<Promise<unknown>>>(new Set());
  const trackSubmit = useCallback((promise: Promise<unknown>) => {
    const wrapped = promise.finally(() =>
      pendingSubmitsRef.current.delete(wrapped),
    );
    wrapped.catch(() => {}); // keep the tracking set rejection-free
    pendingSubmitsRef.current.add(wrapped);
    return wrapped;
  }, []);

  // An answer counts as unsynced when it was cleared (""), so clearing an
  // offline answer is still propagated to the server, or when its serialized
  // value differs from what the server last persisted.
  const isUnsynced = useCallback(
    (qId: string, ans: any, serverAnswers?: ExamAnswer[]) => {
      const serverAns = serverAnswers?.find(
        (a: any) => a.questionId === qId,
      )?.answer;
      return (
        ans !== undefined &&
        (serverAns === undefined ||
          JSON.stringify(serverAns) !== JSON.stringify(ans))
      );
    },
    [],
  );

  const collectUnsynced = useCallback(
    (sourceAnswers: Record<string, any>, serverAnswers?: ExamAnswer[]) =>
      Object.entries(sourceAnswers).filter(([qId, ans]) =>
        isUnsynced(qId, ans, serverAnswers),
      ),
    [isUnsynced],
  );

  const submitAll = useCallback(
    (entries: Array<[string, any]>, attemptId: string) =>
      entries.map(([questionId, answer]) =>
        submitAnswer.mutateAsync({ attemptId, questionId, answer }),
      ),
    [submitAnswer],
  );

  const handleFinish = useCallback(
    async (opts?: { isAuto?: boolean }) => {
      const isAuto = opts?.isAuto ?? false;
      // Await any in-flight autosaves so an older request cannot land after the
      // final sync and overwrite a newer answer on the server.
      const inFlight = Array.from(pendingSubmitsRef.current);
      if (inFlight.length > 0) {
        await Promise.allSettled(inFlight);
      }

      const latest = answersRef.current;
      const serverAnswers = serverAnswersRef.current;
      const unsyncedEntries = collectUnsynced(latest, serverAnswers);

      try {
        if (unsyncedEntries.length > 0) {
          const results = await Promise.allSettled(
            submitAll(unsyncedEntries, attempt.id),
          );
          const hasFailed = results.some((r) => r.status === "rejected");

          if (hasFailed) {
            if (isAuto) {
              // Auto-submit on timeout: retry a few times, then still finish the
              // exam so it is graded instead of silently EXPIRING unmarked.
              for (let retry = 0; retry < 2; retry++) {
                await new Promise((r) => setTimeout(r, 800));
                const retryResults = await Promise.allSettled(
                  submitAll(
                    collectUnsynced(
                      answersRef.current,
                      serverAnswersRef.current,
                    ),
                    attempt.id,
                  ),
                );
                if (retryResults.every((r) => r.status === "fulfilled")) break;
              }
            } else {
              toast.error(
                "Beberapa jawaban gagal dikirim ke server. Mohon periksa koneksi internet Anda dan coba lagi.",
              );
              return;
            }
          }
        }

        await finishExam.mutateAsync(attempt.id);
        if (typeof window !== "undefined") {
          localStorage.removeItem(draftStorageKey);
        }
        toast.success("Ujian selesai!");
        router.push("/student/exams");
      } catch {
        toast.error("Gagal menyelesaikan ujian. Silakan coba lagi.");
      }
    },
    [
      attempt.id,
      collectUnsynced,
      draftStorageKey,
      finishExam,
      router,
      submitAll,
    ],
  );

  // Stable ref so the one-second timer never depends on `handleFinish` (which
  // itself depends on live answer state) — otherwise every keystroke would tear
  // down and restart the interval and the countdown would run slow on essays.
  const handleFinishRef = useRef(handleFinish);
  useEffect(() => {
    handleFinishRef.current = handleFinish;
  }, [handleFinish]);

  const handleAnswerChange = async (value: any) => {
    if (!currentQuestion) return;

    const newAnswers = { ...answersRef.current, [currentQuestion.id]: value };
    answersRef.current = newAnswers;
    setAnswers(newAnswers);

    // Save draft locally with timestamp for offline recovery
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            answers: newAnswers,
            timestamp: Date.now(),
            examId: attempt.examId,
          }),
        );
      } catch (err) {
        console.error("Failed to save draft locally", err);
      }
    }

    try {
      // Track the autosave so finish can await it before finalizing.
      await trackSubmit(
        submitAnswer.mutateAsync({
          attemptId: attempt.id,
          questionId: currentQuestion.id,
          answer: value,
        }),
      );
    } catch {
      console.error("Failed to save answer online; saved to offline draft");
    }
  };

  // Timer & Auto-submit
  useEffect(() => {
    if (attempt.status !== "IN_PROGRESS") return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          toast.warning(
            "Waktu pengerjaan telah habis. Mengirim jawaban otomatis...",
          );
          // Auto-submit path: always completes the exam even if some uploads fail.
          handleFinishRef.current?.({ isAuto: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [attempt.status]);

  // Anti-Cheating: Tab Switch & Window Blur Listener
  useEffect(() => {
    if (attempt.status !== "IN_PROGRESS") return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchCount((prev) => prev + 1);
        toast.error(
          "Peringatan Keamanan: Anda terdeteksi meninggalkan layar ujian! Aktivitas ini dicatat pengawas.",
        );
        recordSecurityLog.mutate({
          attemptId: attempt.id,
          eventType: "TAB_SWITCH",
          details: { note: "Pindah tab atau meminimalkan jendela" },
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [attempt.id, attempt.status, recordSecurityLog]);

  // Offline resilience sync listener
  useEffect(() => {
    if (attempt.status !== "IN_PROGRESS") return;

    const handleOnline = async () => {
      toast.success(
        "Koneksi terhubung kembali. Meringkas sinkronisasi jawaban...",
      );
      // Same unsynced semantics as handleFinish: cleared ("") answers are synced too.
      const unsyncedEntries = collectUnsynced(
        answersRef.current,
        serverAnswersRef.current,
      );

      if (unsyncedEntries.length > 0) {
        await Promise.all(
          submitAll(unsyncedEntries, attempt.id).map((p) =>
            p.catch((e) =>
              console.error("Failed to sync answer on reconnect", e),
            ),
          ),
        );
      }
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [
    attempt.id,
    attempt.status,
    collectUnsynced,
    serverAnswersRef,
    submitAll,
  ]);

  if (attempt.status !== "IN_PROGRESS") {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-96 gap-4">
          <CheckCircle className="h-16 w-16 text-green-500" />
          <h2 className="text-2xl font-bold">Ujian Selesai</h2>
          <p className="text-muted-foreground">
            Terima kasih telah mengerjakan ujian. Jawaban Anda telah tersimpan.
          </p>
          <div className="flex gap-4">
            <Button
              variant="outline"
              onClick={() => router.push("/student/exams")}
            >
              Kembali ke Daftar
            </Button>
            {attempt.score !== undefined && attempt.score !== null && (
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">Nilai Anda</p>
                <p className="text-3xl font-bold text-primary">
                  {Number(attempt.score)}
                </p>
              </Card>
            )}
          </div>
        </div>
      </MainLayout>
    );
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      {/* Top Bar */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="font-semibold text-lg truncate max-w-md">
            {attempt.exam?.title}
          </div>
          <div className="flex items-center gap-4">
            {tabSwitchCount > 0 && (
              <div className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{tabSwitchCount}x Pindah Tab</span>
              </div>
            )}
            <div
              className={`flex items-center gap-2 font-mono text-xl font-bold ${timeLeft < 300 ? "text-red-500" : "text-primary"}`}
            >
              <Timer className="h-5 w-5" />
              {formatTime(timeLeft)}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Selesai
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Selesaikan Ujian?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Pastikan Anda telah menjawab semua soal. Anda tidak dapat
                    mengubah jawaban setelah ini.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleFinish()}
                    className="bg-primary"
                  >
                    Ya, Selesai
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Question Area */}
        <div className="lg:col-span-3 space-y-6">
          <Card
            className="min-h-[400px] flex flex-col select-none"
            onContextMenu={(e) => {
              e.preventDefault();
              toast.warning("Klik kanan dinonaktifkan demi keamanan ujian.");
              recordSecurityLog.mutate({
                attemptId: attempt.id,
                eventType: "RIGHT_CLICK",
                details: { note: "Percobaan membuka menu klik kanan" },
              });
            }}
            onCopy={(e) => {
              e.preventDefault();
              toast.warning("Menyalin teks dinonaktifkan demi keamanan ujian.");
              recordSecurityLog.mutate({
                attemptId: attempt.id,
                eventType: "COPY",
                details: { note: "Percobaan menyalin teks" },
              });
            }}
            onPaste={(e) => {
              e.preventDefault();
              toast.warning("Tempel teks dinonaktifkan.");
              recordSecurityLog.mutate({
                attemptId: attempt.id,
                eventType: "PASTE",
                details: { note: "Percobaan menempel teks" },
              });
            }}
          >
            <CardHeader>
              <div className="flex justify-between">
                <CardTitle>Soal No. {currentIndex + 1}</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {currentQuestion?.points} Poin
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {currentQuestion ? (
                <div className="space-y-6">
                  <div className="prose max-w-none">
                    <p className="whitespace-pre-wrap text-lg">
                      {currentQuestion.content}
                    </p>
                  </div>

                  <div className="pt-4 border-t">
                    {currentQuestion.type === QuestionType.MULTIPLE_CHOICE &&
                      currentQuestion.options && (
                        <RadioGroup
                          value={answers[currentQuestion.id] || ""}
                          onValueChange={handleAnswerChange}
                          className="space-y-3"
                        >
                          {currentQuestion.options.map((option, index) => {
                            const opt =
                              typeof option === "string"
                                ? { id: option, text: option }
                                : option;
                            return (
                              <div
                                key={`${opt.id}-${index}`}
                                className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent cursor-pointer transition-colors"
                              >
                                <RadioGroupItem
                                  value={opt.id}
                                  id={`option-${index}`}
                                />
                                <label
                                  htmlFor={`option-${index}`}
                                  className="flex-1 cursor-pointer font-medium"
                                >
                                  {opt.text}
                                </label>
                              </div>
                            );
                          })}
                        </RadioGroup>
                      )}

                    {currentQuestion.type === QuestionType.TRUE_FALSE && (
                      <RadioGroup
                        value={answers[currentQuestion.id] || ""}
                        onValueChange={handleAnswerChange}
                        className="space-y-3"
                      >
                        <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent cursor-pointer">
                          <RadioGroupItem value="true" id="true" />
                          <label
                            htmlFor="true"
                            className="flex-1 cursor-pointer font-medium"
                          >
                            Benar
                          </label>
                        </div>
                        <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent cursor-pointer">
                          <RadioGroupItem value="false" id="false" />
                          <label
                            htmlFor="false"
                            className="flex-1 cursor-pointer font-medium"
                          >
                            Salah
                          </label>
                        </div>
                      </RadioGroup>
                    )}

                    {currentQuestion.type === QuestionType.ESSAY && (
                      <Textarea
                        placeholder="Tulis jawaban Anda di sini..."
                        value={answers[currentQuestion.id] || ""}
                        onChange={(e) => handleAnswerChange(e.target.value)}
                        className="min-h-[200px]"
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Memuat soal...
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between border-t p-4">
              <Button
                variant="outline"
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Sebelumnya
              </Button>

              <Button
                onClick={() =>
                  setCurrentIndex((prev) =>
                    Math.min(questions.length - 1, prev + 1),
                  )
                }
                disabled={currentIndex === questions.length - 1}
              >
                Selanjutnya
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Navigation Sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Navigasi Soal</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const isAnswered =
                    answers[q.id] !== undefined && answers[q.id] !== "";
                  const isCurrent = currentIndex === idx;

                  return (
                    <button
                      key={q.id}
                      onClick={() => setCurrentIndex(idx)}
                      className={`
                        h-10 w-10 rounded-md text-sm font-medium transition-colors
                        ${
                          isCurrent
                            ? "bg-primary text-primary-foreground ring-2 ring-offset-2 ring-primary"
                            : isAnswered
                              ? "bg-green-500 text-white"
                              : "bg-muted hover:bg-muted/80"
                        }
                      `}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
