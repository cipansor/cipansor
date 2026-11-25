"use client";

import { useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { QuestionType, Question } from "@/hooks/use-cbt";
import { Plus, Trash2, X } from "lucide-react";

const questionSchema = z.object({
  type: z.nativeEnum(QuestionType),
  content: z.string().min(1, "Pertanyaan wajib diisi"),
  points: z.coerce.number().min(1),
  explanation: z.string().optional(),
  // For MC
  options: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().min(1, "Opsi wajib diisi"),
      }),
    )
    .optional(),
  answerKey: z.any().optional(), // Store ID of correct option or boolean or text
});

type QuestionFormData = z.infer<typeof questionSchema>;

function initialOptions(options: Question["options"]) {
  return (options ?? []).map((option) =>
    typeof option === "string" ? { id: option, text: option } : option,
  );
}

interface QuestionFormProps {
  initialData?: Question;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function QuestionForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading,
}: QuestionFormProps) {
  const form = useForm<QuestionFormData>({
    resolver: zodResolver(questionSchema),
    defaultValues: {
      type: initialData?.type || QuestionType.MULTIPLE_CHOICE,
      content: initialData?.content || "",
      points: initialData?.points || 5,
      explanation: initialData?.explanation || "",
      options: initialData?.options
        ? initialOptions(initialData.options)
        : [
            { id: "opt-1", text: "" },
            { id: "opt-2", text: "" },
            { id: "opt-3", text: "" },
            { id: "opt-4", text: "" },
          ],
      answerKey: initialData?.answerKey || null,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "options",
  });

  const watchType = form.watch("type");

  // Generate ID for new options
  const addOption = () => {
    append({ id: `opt-${Date.now()}`, text: "" });
  };

  const handleSubmit = (data: QuestionFormData) => {
    // Clean up data based on type
    const payload = { ...data };
    if (data.type === QuestionType.ESSAY) {
      delete payload.options;
      delete payload.answerKey; // Essay usually manual grading or keyword match (skip for now)
    } else if (data.type === QuestionType.TRUE_FALSE) {
      delete payload.options;
      // answerKey should be boolean or 'true'/'false'
    }
    onSubmit(payload);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipe Soal</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih tipe soal" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={QuestionType.MULTIPLE_CHOICE}>
                    Pilihan Ganda
                  </SelectItem>
                  <SelectItem value={QuestionType.ESSAY}>
                    Esai / Uraian
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
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pertanyaan</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Tulis pertanyaan di sini..."
                  className="min-h-[100px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="points"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Poin</FormLabel>
              <FormControl>
                <Input type="number" min={1} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Multiple Choice Options */}
        {watchType === QuestionType.MULTIPLE_CHOICE && (
          <div className="space-y-4">
            <FormLabel>Pilihan Jawaban</FormLabel>
            <FormField
              control={form.control}
              name="answerKey"
              render={({ field }) => (
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="space-y-3"
                >
                  {fields.map((option, index) => (
                    <div key={option.id} className="flex items-center gap-2">
                      <RadioGroupItem value={option.id} id={option.id} />
                      <div className="flex-1">
                        <Input
                          {...form.register(`options.${index}.text`)}
                          placeholder={`Opsi ${index + 1}`}
                        />
                      </div>
                      {fields.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                        >
                          <X className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  ))}
                </RadioGroup>
              )}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addOption}
              className="mt-2"
            >
              <Plus className="mr-2 h-4 w-4" />
              Tambah Opsi
            </Button>
            <FormMessage>
              {(form.formState.errors.answerKey as any)?.message}
            </FormMessage>
          </div>
        )}

        {/* True/False */}
        {watchType === QuestionType.TRUE_FALSE && (
          <FormField
            control={form.control}
            name="answerKey"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel>Kunci Jawaban</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value?.toString()} // Ensure string comp
                    className="flex flex-col space-y-1"
                  >
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="true" />
                      </FormControl>
                      <FormLabel className="font-normal">Benar</FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="false" />
                      </FormControl>
                      <FormLabel className="font-normal">Salah</FormLabel>
                    </FormItem>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="explanation"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pembahasan (Opsional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Penjelasan jawaban..."
                  className="min-h-[80px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Batal
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <span className="mr-2 animate-spin">⏳</span>}
            Simpan Soal
          </Button>
        </div>
      </form>
    </Form>
  );
}
