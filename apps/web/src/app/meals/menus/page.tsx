"use client";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import Link from "next/link";

import { id as localeId } from "date-fns/locale";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Filter,
  Trash2,
  Edit,
  MoreVertical,
  UtensilsCrossed,
  Sun,
  Sunset,
  Moon,
  Coffee,
  Flame,
  Calendar,
  ArrowLeft,
  FileEdit,
} from "lucide-react";

import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useMealMenus,
  useDeleteMealMenu,
  useCanManageMeals,
  MealType,
  MEAL_TYPE_LABELS,
  MEAL_TYPES,
  MEAL_DAY_TYPE_LABELS,
} from "@/hooks/use-meals";
import { useUnits } from "@/hooks/use-units";

const MEAL_ICONS: Record<MealType, React.ReactNode> = {
  BREAKFAST: <Sun className="h-4 w-4" />,
  LUNCH: <Sunset className="h-4 w-4" />,
  DINNER: <Moon className="h-4 w-4" />,
  SNACK: <Coffee className="h-4 w-4" />,
};

const MEAL_COLORS: Record<MealType, string> = {
  BREAKFAST: "bg-amber-100 text-amber-800",
  LUNCH: "bg-orange-100 text-orange-800",
  DINNER: "bg-indigo-100 text-indigo-800",
  SNACK: "bg-green-100 text-green-800",
};

export default function MenusPage() {
  const [search, setSearch] = useState("");
  const [mealTypeFilter, setMealTypeFilter] = useState<string>("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Queries
  const { data: menus = [], isLoading } = useMealMenus({
    mealType:
      mealTypeFilter !== "all" ? (mealTypeFilter as MealType) : undefined,
    unitId: unitFilter !== "all" ? unitFilter : undefined,
  });
  const { data: units = [] } = useUnits();
  const deleteMutation = useDeleteMealMenu();
  const canManage = useCanManageMeals();

  // Filter menus by search
  const filteredMenus = menus.filter(
    (menu) =>
      menu.name?.toLowerCase().includes(search.toLowerCase()) ||
      menu.mainDish?.toLowerCase().includes(search.toLowerCase()) ||
      menu.sideDish?.toLowerCase().includes(search.toLowerCase()),
  );

  // Handle delete
  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Menu berhasil dihapus");
      setDeleteId(null);
    } catch (error) {
      console.error("Error deleting menu:", error);
      toast.error("Gagal menghapus menu");
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/meals">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <UtensilsCrossed className="h-6 w-6 text-primary" />
              Kelola Menu Makan
            </h1>
            <p className="text-muted-foreground">
              Daftar semua menu makanan yang tersedia
            </p>
          </div>
          {canManage && (
            <Button asChild>
              <Link href="/meals/menus/new">
                <Plus className="h-4 w-4 mr-2" />
                Tambah Menu
              </Link>
            </Button>
          )}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Cari menu..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Select
                  value={mealTypeFilter}
                  onValueChange={setMealTypeFilter}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Tipe Makan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Tipe</SelectItem>
                    {MEAL_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        <div className="flex items-center gap-2">
                          {MEAL_ICONS[type]}
                          {MEAL_TYPE_LABELS[type]}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={unitFilter} onValueChange={setUnitFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Unit</SelectItem>
                    {units.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Menus Table */}
        <Card>
          <CardHeader>
            <CardTitle>Daftar Menu</CardTitle>
            <CardDescription>
              {filteredMenus.length} menu ditemukan
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filteredMenus.length === 0 ? (
              <div className="text-center py-12">
                <UtensilsCrossed className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-semibold">Belum Ada Menu</h3>
                <p className="text-muted-foreground mb-4">
                  Mulai tambahkan menu makanan untuk santri/siswa
                </p>
                {canManage && (
                  <Button asChild>
                    <Link href="/meals/menus/new">
                      <Plus className="h-4 w-4 mr-2" />
                      Tambah Menu Pertama
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Menu</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Hidangan</TableHead>
                    <TableHead>Kalori</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[70px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMenus.map((menu) => (
                    <TableRow key={menu.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{menu.name}</p>
                          {menu.description && (
                            <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {menu.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`gap-1 ${MEAL_COLORS[menu.mealType]}`}
                        >
                          {MEAL_ICONS[menu.mealType]}
                          {MEAL_TYPE_LABELS[menu.mealType]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {safeFormat(new Date(menu.date), "d MMM yyyy", {
                            locale: localeId,
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p className="font-medium">{menu.mainDish}</p>
                          {menu.sideDish && (
                            <p className="text-muted-foreground">
                              {menu.sideDish}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {menu.calories ? (
                          <div className="flex items-center gap-1 text-sm">
                            <Flame className="h-4 w-4 text-orange-500" />
                            {menu.calories} kkal
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {menu.unit?.name || "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={menu.isActive ? "default" : "secondary"}
                        >
                          {menu.isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/meals/menus/${menu.id}`}>
                                <FileEdit className="h-4 w-4 mr-2" />
                                Lihat Detail
                              </Link>
                            </DropdownMenuItem>
                            {canManage && (
                              <>
                                <DropdownMenuItem asChild>
                                  <Link href={`/meals/menus/${menu.id}/edit`}>
                                    <Edit className="h-4 w-4 mr-2" />
                                    Edit
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeleteId(menu.id)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Hapus
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Menu?</AlertDialogTitle>
              <AlertDialogDescription>
                Tindakan ini tidak dapat dibatalkan. Menu yang dihapus akan
                dihilangkan secara permanen dari sistem.
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
