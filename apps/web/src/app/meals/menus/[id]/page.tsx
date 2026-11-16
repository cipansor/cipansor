"use client";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { id as localeId } from "date-fns/locale";
import { toast } from "sonner";
import {
  ArrowLeft,
  Edit,
  Trash2,
  UtensilsCrossed,
  Sun,
  Sunset,
  Moon,
  Coffee,
  Calendar,
  Building2,
  Drumstick,
  Fish,
  Leaf,
  Soup,
  Apple,
  GlassWater,
  Flame,
  AlertCircle,
  CheckCircle,
  XCircle,
  Copy,
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";

import {
  useMealMenu,
  useDeleteMealMenu,
  useCanManageMeals,
  MealType,
  MEAL_TYPE_LABELS,
  MEAL_DAY_TYPE_LABELS,
} from "@/hooks/use-meals";

const MEAL_ICONS: Record<MealType, React.ReactNode> = {
  BREAKFAST: <Sun className="h-5 w-5" />,
  LUNCH: <Sunset className="h-5 w-5" />,
  DINNER: <Moon className="h-5 w-5" />,
  SNACK: <Coffee className="h-5 w-5" />,
};

const MEAL_COLORS: Record<MealType, string> = {
  BREAKFAST: "bg-amber-100 text-amber-800",
  LUNCH: "bg-orange-100 text-orange-800",
  DINNER: "bg-indigo-100 text-indigo-800",
  SNACK: "bg-green-100 text-green-800",
};

export default function MenuDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Queries
  const { data: menu, isLoading, error } = useMealMenu(id);
  const deleteMutation = useDeleteMealMenu();
  const canManage = useCanManageMeals();

  // Handle delete
  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Menu berhasil dihapus");
      router.push("/meals/menus");
    } catch (error) {
      console.error("Error deleting menu:", error);
      toast.error("Gagal menghapus menu");
    }
  };

  // Handle copy menu
  const handleCopyMenu = () => {
    if (!menu) return;

    const menuText = `
📋 ${menu.name}
📅 ${safeFormat(new Date(menu.date), "EEEE, d MMMM yyyy", { locale: localeId })}
🕐 ${MEAL_TYPE_LABELS[menu.mealType]}

🍽️ Hidangan:
${menu.mainDish ? `• Utama: ${menu.mainDish}` : ""}
${menu.sideDish ? `• Lauk: ${menu.sideDish}` : ""}
${menu.vegetable ? `• Sayur: ${menu.vegetable}` : ""}
${menu.soup ? `• Sup: ${menu.soup}` : ""}
${menu.dessert ? `• Buah: ${menu.dessert}` : ""}
${menu.drink ? `• Minuman: ${menu.drink}` : ""}
${menu.calories ? `\n🔥 Kalori: ${menu.calories} kkal` : ""}
    `.trim();

    navigator.clipboard.writeText(menuText);
    toast.success("Menu disalin ke clipboard");
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
              <Skeleton className="h-64" />
              <Skeleton className="h-48" />
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
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/meals/menus">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <UtensilsCrossed className="h-6 w-6 text-primary" />
                {menu.name}
              </h1>
              <p className="text-muted-foreground">
                {safeFormat(new Date(menu.date), "EEEE, d MMMM yyyy", {
                  locale: localeId,
                })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyMenu}>
              <Copy className="h-4 w-4 mr-2" />
              Salin
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/meals/menus/${id}/edit`}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Link>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Hapus
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Menu Type & Status */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-3">
                  <Badge
                    variant="secondary"
                    className={`text-base py-1.5 px-3 ${MEAL_COLORS[menu.mealType]}`}
                  >
                    {MEAL_ICONS[menu.mealType]}
                    <span className="ml-2">
                      {MEAL_TYPE_LABELS[menu.mealType]}
                    </span>
                  </Badge>
                  <Badge variant="outline" className="text-base py-1.5 px-3">
                    <Calendar className="h-4 w-4 mr-2" />
                    {MEAL_DAY_TYPE_LABELS[menu.dayType]}
                  </Badge>
                  <Badge
                    variant={menu.isActive ? "default" : "secondary"}
                    className="text-base py-1.5 px-3"
                  >
                    {menu.isActive ? (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Aktif
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 mr-2" />
                        Nonaktif
                      </>
                    )}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Menu Items Card */}
            <Card>
              <CardHeader>
                <CardTitle>Daftar Hidangan</CardTitle>
                <CardDescription>
                  Komponen makanan dan minuman dalam menu ini
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Main Dish */}
                <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-lg">
                  <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <Drumstick className="h-5 w-5 text-amber-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-amber-700">
                      Hidangan Utama
                    </p>
                    <p className="text-lg font-semibold">{menu.mainDish}</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Side Dish */}
                  {menu.sideDish && (
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Fish className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Lauk Pendamping
                        </p>
                        <p className="font-medium">{menu.sideDish}</p>
                      </div>
                    </div>
                  )}

                  {/* Vegetable */}
                  {menu.vegetable && (
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Leaf className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">Sayuran</p>
                        <p className="font-medium">{menu.vegetable}</p>
                      </div>
                    </div>
                  )}

                  {/* Soup */}
                  {menu.soup && (
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Soup className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Sup/Kuah
                        </p>
                        <p className="font-medium">{menu.soup}</p>
                      </div>
                    </div>
                  )}

                  {/* Dessert */}
                  {menu.dessert && (
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Apple className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Buah/Dessert
                        </p>
                        <p className="font-medium">{menu.dessert}</p>
                      </div>
                    </div>
                  )}

                  {/* Drink */}
                  {menu.drink && (
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <GlassWater className="h-5 w-5 text-cyan-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">Minuman</p>
                        <p className="font-medium">{menu.drink}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* No additional items message */}
                {!menu.sideDish &&
                  !menu.vegetable &&
                  !menu.soup &&
                  !menu.dessert &&
                  !menu.drink && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Tidak ada hidangan tambahan
                    </p>
                  )}
              </CardContent>
            </Card>

            {/* Nutrition Card */}
            {(menu.calories || menu.nutritionInfo) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Flame className="h-5 w-5 text-orange-500" />
                    Informasi Nutrisi
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {menu.calories && (
                    <div className="flex items-center gap-4 p-4 bg-orange-50 rounded-lg">
                      <div className="h-12 w-12 rounded-full bg-orange-100 flex items-center justify-center">
                        <Flame className="h-6 w-6 text-orange-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Kalori
                        </p>
                        <p className="text-2xl font-bold text-orange-600">
                          {menu.calories} kkal
                        </p>
                      </div>
                    </div>
                  )}

                  {menu.nutritionInfo && (
                    <div>
                      <p className="text-sm font-medium mb-2">
                        Catatan Nutrisi
                      </p>
                      <p className="text-muted-foreground">
                        {menu.nutritionInfo}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Description Card */}
            {menu.description && (
              <Card>
                <CardHeader>
                  <CardTitle>Deskripsi</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{menu.description}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Unit Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Unit Pendidikan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">
                  {menu.unit?.name || "Tidak diketahui"}
                </p>
              </CardContent>
            </Card>

            {/* Timestamps Card */}
            <Card>
              <CardHeader>
                <CardTitle>Informasi</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Dibuat:</span>
                  <span>
                    {safeFormat(new Date(menu.createdAt), "d MMM yyyy, HH:mm", {
                      locale: localeId,
                    })}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Diperbarui:</span>
                  <span>
                    {safeFormat(new Date(menu.updatedAt), "d MMM yyyy, HH:mm", {
                      locale: localeId,
                    })}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions Card */}
            <Card>
              <CardHeader>
                <CardTitle>Aksi Cepat</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  asChild
                >
                  <Link href={`/meals/menus/new?duplicate=${id}`}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplikasi Menu
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  asChild
                >
                  <Link href="/meals">
                    <UtensilsCrossed className="h-4 w-4 mr-2" />
                    Lihat Jadwal
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Menu?</AlertDialogTitle>
              <AlertDialogDescription>
                Anda yakin ingin menghapus menu "{menu.name}"? Tindakan ini
                tidak dapat dibatalkan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}
