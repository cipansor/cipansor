"use client";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { useParams, useRouter } from "next/navigation";

import { id as localeId } from "date-fns/locale";
import {
  useQuestionBank,
  useAddQuestion,
  useUpdateQuestion,
  useDeleteQuestion,
  QuestionType,
} from "@/hooks/use-cbt";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { MainLayout } from "@/components/layout";
import {
  answerKeyIdOf,
  nextOptionId,
  optionIdOf,
  uniqueOptionIds,
} from "./option-ids";
import {
  ArrowLeft,
  BookOpen,
  Clock,
  FileQuestion,
  Plus,
  Trash2,
  Edit,
  CheckCircle,
} from "lucide-react";

const questionSchema = z.object({
  type: z.nativeEnum(QuestionType),
  content: z.string().min(5, "Pertanyaan wajib diisi"),
  points: z.number().min(1, "Poin minimal 1"),
  options: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().min(1, "Opsi tidak boleh kosong"),
      }),
    )
    .optional(),
  answerKey: z.string().min(1, "Kunci jawaban wajib diisi"),
  explanation: z.string().optional(),
});

function ExamBankDetailPageContent() {
  const params = useParams();
  const router = useRouter();
  const bankId = params.id as string;

  const { data: bank, isLoading } = useQuestionBank(bankId);
  const addQuestion = useAddQuestion();
  const updateQuestion = useUpdateQuestion();
  const deleteQuestion = useDeleteQuestion();

  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
    null,
  );

  const form = useForm<z.infer<typeof questionSchema>>({
    resolver: zodResolver(questionSchema),
    defaultValues: {
      type: QuestionType.MULTIPLE_CHOICE,
      content: "",
      points: 10,
      options: [
        { id: "A", text: "" },
        { id: "B", text: "" },
        { id: "C", text: "" },
        { id: "D", text: "" },
      ],
      answerKey: "A",
      explanation: "",
    },
  });

  const {
    fields: optionFields,
    append: appendOption,
    remove: removeOption,
  } = useFieldArray({
    control: form.control,
    name: "options",
  });

  const questionType = form.watch("type");
  const options = form.watch("options") ?? [];

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!bank) {
    return (
      <div className="container mx-auto py-20 text-center">
        <h2 className="text-2xl font-bold mb-2">Bank Soal Tidak Ditemukan</h2>
        <Button onClick={() => router.back()}>Kembali</Button>
      </div>
    );
  }

  const handleEditQuestion = (q: any) => {
    setEditingQuestionId(q.id);
    form.reset({
      type: q.type,
      content: q.content,
      points: q.points,
      options: uniqueOptionIds(
        (q.options || []).map((option: any, index: number) => ({
          ...option,
          id: optionIdOf(option?.id, index),
        })),
      ),
      answerKey: answerKeyIdOf(q.answerKey) ?? "",
      explanation: q.explanation || "",
    });
    setQuestionDialogOpen(true);
  };

  const handleOpenAdd = () => {
    setEditingQuestionId(null);
    form.reset({
      type: QuestionType.MULTIPLE_CHOICE,
      content: "",
      points: 10,
      options: [
        { id: "A", text: "" },
        { id: "B", text: "" },
        { id: "C", text: "" },
        { id: "D", text: "" },
      ],
      answerKey: "A",
    });
    setQuestionDialogOpen(true);
  };

  const onQuestionSubmit = async (values: z.infer<typeof questionSchema>) => {
    const normalizedOptions = values.options?.map((option, index) => ({
      ...option,
      id: optionIdOf(option.id, index),
    }));
    const data = {
      ...values,
      options: normalizedOptions
        ? uniqueOptionIds(normalizedOptions)
        : normalizedOptions,
      answerKey: answerKeyIdOf(values.answerKey) ?? "",
    };
    try {
      if (editingQuestionId) {
        await updateQuestion.mutateAsync({
          bankId,
          questionId: editingQuestionId,
          data,
        });
      } else {
        await addQuestion.mutateAsync({
          bankId,
          data,
        });
      }
      setQuestionDialogOpen(false);
    } catch (error) {
      console.error(error);
    }
  };

  const handleRemoveOption = (index: number) => {
    const removedId = optionIdOf(options[index]?.id, index);
    removeOption(index);
    if (answerKeyIdOf(form.getValues("answerKey")) === removedId) {
      // The key belonged to the deleted option. Do not choose another one for
      // the teacher: clear it and let validation force a deliberate choice.
      form.setValue("answerKey", "", { shouldValidate: true });
    }
  };

  const handleDelete = async (questionId: string) => {
    if (confirm("Hapus pertanyaan ini?")) {
      await deleteQuestion.mutateAsync({ bankId, questionId });
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button
        variant="ghost"
        className="mb-2 -ml-4"
        onClick={() => router.back()}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Kembali
      </Button>

      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex-1">
          <PageHeader
            title={bank.title}
            description={`Mata Pelajaran: ${bank.subject?.name || "Umum"}`}
          />
        </div>

        <div className="flex items-center gap-2">
          {bank.isActive ? (
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200">
              Aktif (Dapat Digunakan Ujian)
            </Badge>
          ) : (
            <Badge variant="outline" className="text-slate-500">
              Draft
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="w-5 h-5" /> Ringkasan Bank Soal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm rounded-md leading-relaxed p-4 border bg-muted/20">
              {bank.description || "Belum ada deskripsi spesifik."}
            </p>
            <div className="flex gap-6 mt-4 pt-4 border-t px-2">
              <div>
                <span className="text-xs text-muted-foreground block mb-1">
                  Total Pertanyaan
                </span>
                <span className="text-2xl font-bold">
                  {bank.questions?.length || 0}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-1">
                  Total Poin Maksimal
                </span>
                <span className="text-2xl font-bold text-primary">
                  {bank.questions?.reduce(
                    (acc: number, curr: any) => acc + (curr.points || 0),
                    0,
                  ) || 0}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="w-5 h-5" /> Properti
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Pembuat (Guru)</span>
              <span className="font-medium">
                {bank.teacherRel?.user?.name || "-"}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Dibuat Pada</span>
              <span className="font-medium">
                {safeFormat(new Date(bank.createdAt), "dd MMM yyyy", {
                  locale: localeId,
                })}
              </span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-muted-foreground">Level Kelas</span>
              <span className="font-medium">Semua (Default)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileQuestion className="w-5 h-5" /> Daftar Pertanyaan
            </CardTitle>
            <CardDescription>
              Kelola soal-soal latihan dan ujian dalam bank ini.
            </CardDescription>
          </div>
          <Dialog
            open={questionDialogOpen}
            onOpenChange={setQuestionDialogOpen}
          >
            <DialogTrigger asChild>
              <Button size="sm" onClick={handleOpenAdd}>
                <Plus className="w-4 h-4 mr-1" /> Tambah Soal
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingQuestionId
                    ? "Edit Pertanyaan"
                    : "Buat Pertanyaan Baru"}
                </DialogTitle>
                <DialogDescription>
                  Masukkan rincian soal, bobot nilai, dan tentukan kunci
                  jawabannya.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onQuestionSubmit)}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipe Pertanyaan</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={QuestionType.MULTIPLE_CHOICE}>
                                Pilihan Ganda
                              </SelectItem>
                              <SelectItem value={QuestionType.ESSAY}>
                                Esai (Essay)
                              </SelectItem>
                              <SelectItem value={QuestionType.TRUE_FALSE}>
                                Benar / Salah
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="points"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bobot Nilai (Poin)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) =>
                                field.onChange(Number(e.target.value))
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="content"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Teks Soal / Pertanyaan</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Tuliskan pertanyaan disini..."
                            rows={4}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Dynamic Options for Multiple Choice */}
                  {questionType === QuestionType.MULTIPLE_CHOICE && (
                    <div className="space-y-3 p-4 border rounded-md bg-muted/10">
                      <div className="flex items-center justify-between mb-2">
                        <FormLabel className="m-0">
                          Pilihan Jawaban (Opsi)
                        </FormLabel>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            appendOption({
                              id: nextOptionId(options.map((o) => o.id)),
                              text: "",
                            })
                          }
                        >
                          Tambah Opsi
                        </Button>
                      </div>
                      {optionFields.map((field, index) => (
                        <div key={field.id} className="flex items-center gap-3">
                          <span className="font-bold w-6 text-center">
                            {options[index]?.id ??
                              String.fromCharCode(65 + index)}
                          </span>
                          <FormField
                            control={form.control}
                            name={`options.${index}.text`}
                            render={({ field: inputField }) => (
                              <FormItem className="flex-1 m-0">
                                <FormControl>
                                  <Input
                                    placeholder={`Teks pilihan ${
                                      options[index]?.id ??
                                      String.fromCharCode(65 + index)
                                    }...`}
                                    {...inputField}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-red-500"
                            onClick={() => handleRemoveOption(index)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="answerKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Kunci Jawaban</FormLabel>
                        {questionType === QuestionType.MULTIPLE_CHOICE ? (
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih Opsi Kunci Jawaban" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {options.map((opt) => (
                                <SelectItem key={opt.id} value={opt.id}>
                                  Opsi {opt.id}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : questionType === QuestionType.TRUE_FALSE ? (
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Benar atau Salah?" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="TRUE">Benar (True)</SelectItem>
                              <SelectItem value="FALSE">
                                Salah (False)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <FormControl>
                            <Textarea
                              placeholder="Contoh acuan jawaban benar..."
                              rows={2}
                              {...field}
                            />
                          </FormControl>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2 pt-4 border-t mt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setQuestionDialogOpen(false)}
                    >
                      Batal
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        addQuestion.isPending || updateQuestion.isPending
                      }
                    >
                      {addQuestion.isPending || updateQuestion.isPending
                        ? "Menyimpan..."
                        : "Simpan Pertanyaan"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {bank.questions && bank.questions.length > 0 ? (
            <div className="space-y-4">
              {bank.questions.map((q: any, index: number) => (
                <div
                  key={q.id}
                  className="border rounded-md p-4 group relative hover:border-primary/50 transition-colors"
                >
                  <div className="absolute right-4 top-4 hidden group-hover:flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditQuestion(q)}
                    >
                      <Edit className="w-4 h-4 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(q.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> Hapus
                    </Button>
                  </div>

                  <div className="flex gap-3 items-start pr-32">
                    <div className="bg-primary/10 text-primary w-8 h-8 rounded-full flex items-center justify-center font-bold shrink-0">
                      {index + 1}
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary">
                            {q.type.replace("_", " ")}
                          </Badge>
                          <span className="text-xs font-semibold text-muted-foreground mr-1">
                            Bobot: {q.points} Poin
                          </span>
                        </div>
                        <p className="text-sm font-medium whitespace-pre-wrap">
                          {q.content}
                        </p>
                      </div>

                      {q.type === QuestionType.MULTIPLE_CHOICE && q.options && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                          {q.options.map((opt: any, optIdx: number) => {
                            const optionId = optionIdOf(opt?.id, optIdx);
                            const answerKey = answerKeyIdOf(q.answerKey);
                            const isCorrect =
                              answerKey !== null && optionId === answerKey;
                            return (
                              <div
                                key={`${optionId}-${optIdx}`}
                                data-option-id={optionId}
                                data-correct={isCorrect ? "true" : "false"}
                                className={`text-sm p-2 rounded border flex items-center gap-2 ${isCorrect ? "bg-green-50 border-green-200" : "bg-muted/20 border-transparent"}`}
                              >
                                <span
                                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${isCorrect ? "bg-green-500 text-white" : "bg-slate-200 text-slate-700"}`}
                                >
                                  {optionId}
                                </span>
                                <span
                                  className={
                                    isCorrect
                                      ? "font-medium text-green-900"
                                      : "text-slate-700"
                                  }
                                >
                                  {opt.text}
                                </span>
                                {isCorrect && (
                                  <CheckCircle className="w-4 h-4 text-green-600 ml-auto" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {q.type !== QuestionType.MULTIPLE_CHOICE && (
                        <div className="bg-muted/30 border p-3 rounded mt-2">
                          <span className="text-xs font-bold text-muted-foreground block mb-1">
                            KUNCI JAWABAN:
                          </span>
                          <span className="text-sm font-medium">
                            {q.answerKey}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
              <FileQuestion className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Belum ada pertanyaan di bank soal ini.</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={handleOpenAdd}
              >
                Buat Pertanyaan Pertama
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ExamBankDetailPage() {
  return (
    <MainLayout>
      <ExamBankDetailPageContent />
    </MainLayout>
  );
}
