"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  User,
  BookOpen,
  Target,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout";

function HalaqohPageContent() {
  const router = useRouter();
  const [selectedHalaqohId, setSelectedHalaqohId] = useState<string>("all");

  // Fetch Halaqohs
  const { data: halaqohs, isLoading: isLoadingHalaqohs } = useQuery({
    queryKey: ["takhosus", "halaqoh"],
    queryFn: async () => {
      const res = await api.get("/takhosus/halaqoh", {
        params: { limit: 100 },
      });
      // The list endpoint returns the rows at `data.data` and the pagination
      // block as a *sibling* of `data` — there is no third `data` nesting.
      return res.data.data ?? [];
    },
  });

  // Fetch Students (Enrollments)
  const { data: enrollments, isLoading: isLoadingEnrollments } = useQuery({
    queryKey: ["takhosus", "enrollment", selectedHalaqohId],
    queryFn: async () => {
      const params: any = { limit: 100, status: "ACTIVE" };
      if (selectedHalaqohId !== "all") {
        params.halaqohId = selectedHalaqohId;
      }
      const res = await api.get("/takhosus/enrollment", { params });
      return res.data.data ?? [];
    },
  });

  if (isLoadingHalaqohs) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Manajemen Halaqoh
          </h1>
          <p className="text-muted-foreground mt-2">
            Pantau perkembangan santri dan target hafalan per kelompok.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push("/takhosus/targets")}
          >
            <Target className="mr-2 h-4 w-4" /> Atur Target
          </Button>
          <Button onClick={() => router.push("/takhosus/halaqoh/new")}>
            Buat Halaqoh
          </Button>
        </div>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Pilih Halaqoh:</label>
            <Select
              value={selectedHalaqohId}
              onValueChange={setSelectedHalaqohId}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Semua Halaqoh" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Halaqoh</SelectItem>
                {halaqohs?.map((h: any) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name} - {h.teacher?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Student List */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Santri Active</CardTitle>
          <CardDescription>
            Menampilkan progress hafalan santri dalam halaqoh yang dipilih.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingEnrollments ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : enrollments?.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground">
              Tidak ada santri ditemukan.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Santri</TableHead>
                  <TableHead>Halaqoh</TableHead>
                  <TableHead>Target Juz</TableHead>
                  <TableHead>Juz Selesai</TableHead>
                  <TableHead>Current Juz</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments?.map((enrollment: any) => (
                  <TableRow key={enrollment.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-full">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">
                            {enrollment.student.user.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {enrollment.student.unit.name}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {enrollment.halaqoh?.name || "No Halaqoh"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Target className="h-3 w-3 text-muted-foreground" />
                        <span>{enrollment.targetJuz} Juz</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        <span>{enrollment.completedJuz} Juz</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-3 w-3 text-blue-500" />
                        <span>Juz {enrollment.currentJuz}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="w-full bg-secondary rounded-full h-2.5">
                        <div
                          className="bg-primary h-2.5 rounded-full"
                          style={{
                            width: `${Math.min(100, enrollment.progressPercentage)}%`,
                          }}
                        ></div>
                      </div>
                      <span className="text-xs text-muted-foreground mt-1 inline-block">
                        {enrollment.progressPercentage}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          router.push(
                            `/student/${enrollment.student.id}/takhosus`,
                          )
                        }
                      >
                        Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function HalaqohPage() {
  return (
    <MainLayout>
      <HalaqohPageContent />
    </MainLayout>
  );
}
