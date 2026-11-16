"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Save,
  UtensilsCrossed,
  Drumstick,
  Fish,
  Leaf,
  Soup,
  Apple,
  GlassWater,
  Flame,
  Info,
  AlertCircle,
} from "lucide-react";

import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

import {
  useMealMenu,
  useUpdateMealMenu,
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
} from "@/hooks/use-meals";
import { useUnits } from "@/hooks/use-units";
import { updateMenuSchema } from "@cipansor/shared";

/**
 * The update contract is @cipansor/shared's `updateMenuSchema`, read by the API
 * too (#1081). Two fields are adapted for the form: the date picker holds a
 * `Date` (the schema wants "yyyy-MM-dd", formatted on submit), and the calories
 * input yields a string. An emptied calories field means "clear it": the schema
 * accepts `null` for the update, so "" is sent as `null` rather than dropped —
 * otherwise the old number stayed stored and the form reported success. An
 * untouched empty field stays `undefined` (omitted), which the service reads as
 * "leave the column alone". Every other empty field stays `""` (the model's text
 * columns are nullable but the contract keeps them as strings).
 */
const formSchema = updateMenuSchema
  .omit({ date: true, calories: true })
  .extend({
    date: z.date({ error: "Tanggal wajib diisi" }),
    calories: z.preprocess((v) => {
      if (v === "" || v === null) return null;
      if (v === undefined) return undefined;
      return Number(v);
    }, z.number().int().positive("Kalori harus bilangan positif").nullable().optional()),
  });

type UpdateMenuFormValues = z.infer<typeof formSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const typedResolver = zodResolver(formSchema) as any;

export default function EditMenuPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  // Queries
  const { data: menu, isLoading, error } = useMealMenu(id);
  const { data: units = [] } = useUnits();
  const updateMutation = useUpdateMealMenu();

  // Form setup
  const form = useForm<UpdateMenuFormValues>({
    resolver: typedResolver,
    defaultValues: {
      mealType: "BREAKFAST",
      date: new Date(),
      mainDish: "",
      sideDish: "",
      vegetable: "",
      soup: "",
      dessert: "",
      drink: "",
      calories: undefined,
      notes: "",
      unitId: "",
    },
  });

  // Populate form when data loads
  useEffect(() => {
    if (menu) {
      form.reset({
        mealType: menu.mealType,
        date: parseISO(menu.date),
        mainDish: menu.mainDish,
        sideDish: menu.sideDish || "",
        vegetable: menu.vegetable || "",
        soup: menu.soup || "",
        dessert: menu.dessert || "",
        drink: menu.drink || "",
        calories: menu.calories ?? undefined,
        notes: menu.notes || "",
        unitId: menu.unitId,
      });
    }
  }, [menu, form]);

  // Handle submit
  const onSubmit = async (values: UpdateMenuFormValues) => {
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          ...values,
          date: format(values.date, "yyyy-MM-dd"),
        },
      });
      toast.success("Menu berhasil diperbarui");
      router.push(`/meals/menus/${id}`);
    } catch (error) {
      console.error("Error updating menu:", error);
      toast.error("Gagal memperbarui menu");
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <MainLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-10" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Skeleton className="h-96" />
              <Skeleton className="h-64" />
            </div>
            <div className="space-y-6">
              <Skeleton className="h-48" />
              <Skeleton className="h-32" />
            </div>
          </div>
        </div>
      </MainLayout>
    );
  }

  // Error state
  if (error || !menu) {
    return (
      <MainLayout>
        <div className="space-y-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error ? "Gagal memuat data menu" : "Menu tidak ditemukan"}
            </AlertDescription>
          </Alert>
          <Button variant="outline" asChild>
            <Link href="/meals/menus">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Kembali ke Daftar
            </Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/meals/menus/${id}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <UtensilsCrossed className="h-6 w-6 text-primary" />
              Edit Menu
            </h1>
            <p className="text-muted-foreground">{menu.mainDish}</p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Main Form */}
              <div className="lg:col-span-2 space-y-6">
                {/* Basic Info Card */}
                <Card>
                  <CardHeader>
                    <CardTitle>Informasi Dasar</CardTitle>
                    <CardDescription>
                      Waktu makan dan tanggal menu
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Meal Type */}
                      <FormField
                        control={form.control}
                        name="mealType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Waktu Makan</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih waktu" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {MEAL_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {MEAL_TYPE_LABELS[type]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Date */}
                      <FormField
                        control={form.control}
                        name="date"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tanggal</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      "w-full pl-3 text-left font-normal",
                                      !field.value && "text-muted-foreground",
                                    )}
                                  >
                                    {field.value ? (
                                      format(field.value, "dd/MM/yyyy")
                                    ) : (
                                      <span>Pilih tanggal</span>
                                    )}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-auto p-0"
                                align="start"
                              >
                                <Calendar
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  autoFocus
                                />
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Menu Items Card */}
                <Card>
                  <CardHeader>
                    <CardTitle>Daftar Hidangan</CardTitle>
                    <CardDescription>
                      Detail makanan dan minuman dalam menu
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Main Dish */}
                    <FormField
                      control={form.control}
                      name="mainDish"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <Drumstick className="h-4 w-4 text-amber-600" />
                            Hidangan Utama
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Contoh: Nasi + Ayam Goreng"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Side Dish */}
                      <FormField
                        control={form.control}
                        name="sideDish"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <Fish className="h-4 w-4 text-blue-600" />
                              Lauk Pendamping
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Contoh: Tempe Goreng"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Vegetable */}
                      <FormField
                        control={form.control}
                        name="vegetable"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <Leaf className="h-4 w-4 text-green-600" />
                              Sayuran
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Contoh: Ca Kangkung"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      {/* Soup */}
                      <FormField
                        control={form.control}
                        name="soup"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <Soup className="h-4 w-4 text-orange-600" />
                              Sup/Kuah
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Contoh: Sop Ayam"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Dessert */}
                      <FormField
                        control={form.control}
                        name="dessert"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <Apple className="h-4 w-4 text-red-600" />
                              Buah/Dessert
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Contoh: Buah Semangka"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Drink */}
                      <FormField
                        control={form.control}
                        name="drink"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <GlassWater className="h-4 w-4 text-cyan-600" />
                              Minuman
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Contoh: Teh Manis"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Nutrition & Notes Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Flame className="h-5 w-5 text-orange-500" />
                      Kalori & Catatan
                    </CardTitle>
                    <CardDescription>
                      Perkiraan kalori dan catatan menu (opsional)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Calories */}
                    <FormField
                      control={form.control}
                      name="calories"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kalori (kkal)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="Contoh: 500"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormDescription>
                            Perkiraan total kalori per porsi
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Notes */}
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Catatan (Opsional)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Contoh: bahan, catatan dapur, alergen..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* Form Actions */}
                <div className="flex items-center gap-4">
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending}
                    className="min-w-[120px]"
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Simpan
                      </>
                    )}
                  </Button>
                  <Button type="button" variant="outline" asChild>
                    <Link href={`/meals/menus/${id}`}>Batal</Link>
                  </Button>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Unit Selection Card */}
                <Card>
                  <CardHeader>
                    <CardTitle>Unit Pendidikan</CardTitle>
                    <CardDescription>Pilih unit untuk menu ini</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FormField
                      control={form.control}
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih unit" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {units.map((unit) => (
                                <SelectItem key={unit.id} value={unit.id}>
                                  {unit.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* Tips Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      Tips
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-2">
                    <p>
                      • Satu unit hanya boleh punya satu menu per waktu makan
                      dan tanggal
                    </p>
                    <p>
                      • Isi informasi kalori untuk membantu monitoring nutrisi
                      santri
                    </p>
                    <p>
                      • Pastikan hidangan utama dan lauk sesuai dengan standar
                      gizi (Isi Piringku)
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </form>
        </Form>
      </div>
    </MainLayout>
  );
}
