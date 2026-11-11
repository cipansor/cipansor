"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Layers,
  Target,
  Leaf,
  Plus,
  Search,
  Trash2,
  Eye,
  Pencil,
  Calendar,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { type ColumnDef } from "@/components/shared";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { useUnits } from "@/hooks/use-units";
import { useAcademicYears } from "@/hooks/use-academic-years";
import {
  useLearningPhases,
  useLearningOutcomes,
  useP5Projects,
  useP5Themes,
  useCreateLearningPhase,
  useCreateLearningOutcome,
  useCreateP5Project,
  useDeleteLearningOutcome,
  useDeleteP5Project,
  LearningPhase,
  LearningOutcome,
  P5Project,
  P5ThemeData,
  LEARNING_PHASE_CODES,
  LearningPhaseCode,
  P5_DIMENSIONS,
  P5DimensionCode,
  ProjectStatus,
  PROJECT_STATUSES,
} from "@/hooks/use-kurikulum-merdeka";
import { useSubjects } from "@/hooks/use-curriculum";
import { useEmployees } from "@/hooks/use-hr";

export default function KurikulumMerdekaPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("phases");
  const [searchQuery, setSearchQuery] = useState("");

  // Filter states
  const [selectedPhase, setSelectedPhase] = useState<string>("");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [selectedTheme, setSelectedTheme] = useState<string>("");

  // Dialog states
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form states
  const [phaseForm, setPhaseForm] = useState({
    code: "" as LearningPhaseCode | "",
    name: "",
    description: "",
    gradeRange: "",
  });

  const [outcomeForm, setOutcomeForm] = useState({
    phaseId: "",
    subjectId: "",
    code: "",
    description: "",
  });

  const [projectForm, setProjectForm] = useState({
    academicYearId: "",
    unitId: "",
    themeId: "",
    title: "",
    description: "",
    dimensions: [] as P5DimensionCode[],
    startDate: "",
    endDate: "",
    supervisorId: "",
  });

  // Data hooks
  const { data: units } = useUnits();
  const { data: academicYears } = useAcademicYears();
  const { data: subjects } = useSubjects();
  const { data: employeesData } = useEmployees({ status: "ACTIVE" });
  const { data: phases, isLoading: loadingPhases } = useLearningPhases();
  const { data: p5Themes } = useP5Themes();
  const { data: outcomesData, isLoading: loadingOutcomes } =
    useLearningOutcomes({
      phaseId: selectedPhase || undefined,
      search: searchQuery || undefined,
    });
  const { data: projectsData, isLoading: loadingProjects } = useP5Projects({
    unitId: selectedUnit || undefined,
    themeId: selectedTheme || undefined,
  });

  // Extract arrays from paginated responses
  const outcomes = outcomesData?.data || [];
  const projects = projectsData?.data || [];

  // Mutations
  const createPhase = useCreateLearningPhase();
  const createOutcome = useCreateLearningOutcome();
  const createProject = useCreateP5Project();
  const deleteOutcome = useDeleteLearningOutcome();
  const deleteProject = useDeleteP5Project();

  // Phase columns
  const phaseColumns: ColumnDef<LearningPhase>[] = [
    {
      accessorKey: "code",
      header: "Kode",
      cell: ({ row }) => (
        <Badge variant="outline">{row.getValue("code")}</Badge>
      ),
    },
    {
      accessorKey: "name",
      header: "Nama Fase",
      cell: ({ row }) => (
        <div className="font-medium">{row.getValue("name")}</div>
      ),
    },
    {
      id: "grades",
      header: "Jenjang Kelas",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.gradeRange || "-"}
        </span>
      ),
    },
    {
      accessorKey: "description",
      header: "Deskripsi",
      cell: ({ row }) => (
        <span className="text-muted-foreground line-clamp-1">
          {row.getValue("description") || "-"}
        </span>
      ),
    },
    {
      id: "outcomes",
      header: "Capaian Pembelajaran",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original._count?.learningOutcomes || 0} CP
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedPhase(row.original.id);
              setActiveTab("outcomes");
            }}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {/* No delete: the phases (Fondasi, A–F) are set by national
              curriculum regulation, and learning outcomes hang on them. */}
        </div>
      ),
    },
  ];

  // Outcome columns
  const outcomeColumns: ColumnDef<LearningOutcome>[] = [
    {
      accessorKey: "code",
      header: "Kode",
      cell: ({ row }) => (
        <Badge variant="outline">{row.getValue("code")}</Badge>
      ),
    },
    {
      id: "subject",
      header: "Mata Pelajaran",
      cell: ({ row }) => (
        <div className="font-medium">{row.original.subject?.name || "-"}</div>
      ),
    },
    {
      accessorKey: "description",
      header: "Deskripsi CP",
      cell: ({ row }) => (
        <span className="text-muted-foreground line-clamp-2">
          {row.getValue("description")}
        </span>
      ),
    },
    {
      id: "phase",
      header: "Fase",
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.phase?.name || "-"}</Badge>
      ),
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.getValue("isActive") ? "default" : "secondary"}>
          {row.getValue("isActive") ? "Aktif" : "Nonaktif"}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDeleteId(row.original.id)}
          className="text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  // Project columns
  const projectColumns: ColumnDef<P5Project>[] = [
    {
      accessorKey: "title",
      header: "Judul Proyek",
      cell: ({ row }) => (
        <div className="font-medium">{row.getValue("title")}</div>
      ),
    },
    {
      id: "theme",
      header: "Tema",
      cell: ({ row }) => {
        const themeName = row.original.theme?.name || "-";
        return <Badge variant="secondary">{themeName}</Badge>;
      },
    },
    {
      id: "unit",
      header: "Unit",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.unit?.name || "-"}
        </span>
      ),
    },
    {
      id: "period",
      header: "Periode",
      cell: ({ row }) => {
        const start = row.original.startDate
          ? new Date(row.original.startDate).toLocaleDateString("id-ID")
          : "";
        const end = row.original.endDate
          ? new Date(row.original.endDate).toLocaleDateString("id-ID")
          : "";
        return (
          <span className="text-muted-foreground">
            {start && end ? `${start} - ${end}` : "-"}
          </span>
        );
      },
    },
    {
      id: "dimensions",
      header: "Dimensi",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.dimensions?.slice(0, 2).map((dim) => {
            const dimData = P5_DIMENSIONS.find((d) => d.value === dim);
            return (
              <Badge key={dim} variant="outline" className="text-xs">
                {dimData?.value || dim}
              </Badge>
            );
          })}
          {(row.original.dimensions?.length || 0) > 2 && (
            <Badge variant="outline" className="text-xs">
              +{(row.original.dimensions?.length || 0) - 2}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "assessments",
      header: "Penilaian",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original._count?.assessments || 0} siswa
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.getValue("status") as ProjectStatus;
        const statusData = PROJECT_STATUSES.find((s) => s.value === status);
        return (
          <Badge className={statusData?.color || ""}>
            {statusData?.label || status}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              router.push(`/curriculum/merdeka/p5/${row.original.id}`)
            }
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteId(row.original.id)}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const handleAdd = async () => {
    try {
      if (activeTab === "phases") {
        if (!phaseForm.code) {
          toast.error("Pilih kode fase");
          return;
        }
        const phaseData = LEARNING_PHASE_CODES.find(
          (p) => p.value === phaseForm.code,
        );
        await createPhase.mutateAsync({
          code: phaseForm.code as LearningPhaseCode,
          name: phaseForm.name || phaseData?.label || "",
          description: phaseForm.description || undefined,
          gradeRange:
            phaseForm.gradeRange ||
            `Kelas ${phaseData?.startGrade} - ${phaseData?.endGrade}`,
        });
        toast.success("Fase berhasil ditambahkan");
        setPhaseForm({ code: "", name: "", description: "", gradeRange: "" });
      } else if (activeTab === "outcomes") {
        if (!outcomeForm.phaseId || !outcomeForm.subjectId) {
          toast.error("Pilih fase dan mata pelajaran");
          return;
        }
        await createOutcome.mutateAsync({
          phaseId: outcomeForm.phaseId,
          subjectId: outcomeForm.subjectId,
          code: outcomeForm.code,
          description: outcomeForm.description,
        });
        toast.success("Capaian Pembelajaran berhasil ditambahkan");
        setOutcomeForm({
          phaseId: "",
          subjectId: "",
          code: "",
          description: "",
        });
      } else if (activeTab === "p5") {
        if (
          !projectForm.academicYearId ||
          !projectForm.unitId ||
          !projectForm.themeId ||
          !projectForm.supervisorId
        ) {
          toast.error("Lengkapi semua field yang diperlukan");
          return;
        }
        if (!projectForm.startDate || !projectForm.endDate) {
          toast.error("Tentukan tanggal mulai dan selesai");
          return;
        }
        if (projectForm.dimensions.length === 0) {
          toast.error("Pilih minimal satu dimensi P5");
          return;
        }
        await createProject.mutateAsync({
          academicYearId: projectForm.academicYearId,
          unitId: projectForm.unitId,
          themeId: projectForm.themeId,
          title: projectForm.title,
          description: projectForm.description,
          dimensions: projectForm.dimensions,
          startDate: projectForm.startDate,
          endDate: projectForm.endDate,
          supervisorId: projectForm.supervisorId,
        });
        toast.success("Proyek P5 berhasil ditambahkan");
        setProjectForm({
          academicYearId: "",
          unitId: "",
          themeId: "",
          title: "",
          description: "",
          dimensions: [],
          startDate: "",
          endDate: "",
          supervisorId: "",
        });
      }
      setIsAddDialogOpen(false);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Gagal menambahkan data";
      toast.error(errorMessage);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      if (activeTab === "outcomes") {
        await deleteOutcome.mutateAsync(deleteId);
        toast.success("Capaian Pembelajaran berhasil dihapus");
      } else if (activeTab === "p5") {
        await deleteProject.mutateAsync(deleteId);
        toast.success("Proyek P5 berhasil dihapus");
      }
      setDeleteId(null);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Gagal menghapus data";
      toast.error(errorMessage);
    }
  };

  const getTabLabel = () => {
    switch (activeTab) {
      case "phases":
        return "Fase";
      case "outcomes":
        return "Capaian Pembelajaran";
      case "p5":
        return "Proyek P5";
      default:
        return "";
    }
  };

  const stats = [
    {
      title: "Fase Pembelajaran",
      value: phases?.length || 0,
      icon: Layers,
      color: "text-blue-600",
      bgColor: "bg-blue-100",
    },
    {
      title: "Capaian Pembelajaran",
      value: outcomesData?.meta?.total || outcomes.length,
      icon: Target,
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    {
      title: "Proyek P5",
      value: projectsData?.meta?.total || projects.length,
      icon: Leaf,
      color: "text-orange-600",
      bgColor: "bg-orange-100",
    },
    {
      title: "Proyek Aktif",
      value: projects.filter((p) => p.status === "ACTIVE").length,
      icon: BookOpen,
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
  ];

  return (
    <MainLayout>
      <PageHeader
        title="Kurikulum Merdeka"
        description="Kelola Capaian Pembelajaran (CP) dan Projek Penguatan Profil Pelajar Pancasila (P5)"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Kurikulum Merdeka" },
        ]}
      />

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className={`${stat.bgColor} p-3 rounded-lg`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Data Kurikulum Merdeka</CardTitle>
              <CardDescription>
                Kelola fase, capaian pembelajaran, dan proyek P5
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cari..."
                  className="pl-10 w-[150px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Tambah {getTabLabel()}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Tambah {getTabLabel()}</DialogTitle>
                    <DialogDescription>
                      Masukkan data {getTabLabel().toLowerCase()} baru
                    </DialogDescription>
                  </DialogHeader>

                  {activeTab === "phases" && (
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>Kode Fase *</Label>
                        <Select
                          value={phaseForm.code}
                          onValueChange={(val: LearningPhaseCode) => {
                            const phaseData = LEARNING_PHASE_CODES.find(
                              (p) => p.value === val,
                            );
                            setPhaseForm({
                              ...phaseForm,
                              code: val,
                              name: phaseData?.label || "",
                              gradeRange: `Kelas ${phaseData?.startGrade} - ${phaseData?.endGrade}`,
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih fase" />
                          </SelectTrigger>
                          <SelectContent>
                            {LEARNING_PHASE_CODES.map((phase) => (
                              <SelectItem key={phase.value} value={phase.value}>
                                {phase.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="phase-name">Nama Fase *</Label>
                        <Input
                          id="phase-name"
                          placeholder="Fase A (PAUD - Kelas 2 SD)"
                          value={phaseForm.name}
                          onChange={(e) =>
                            setPhaseForm({ ...phaseForm, name: e.target.value })
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="phase-range">Jenjang Kelas</Label>
                        <Input
                          id="phase-range"
                          placeholder="Kelas 1 - 2"
                          value={phaseForm.gradeRange}
                          onChange={(e) =>
                            setPhaseForm({
                              ...phaseForm,
                              gradeRange: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="phase-desc">Deskripsi</Label>
                        <Textarea
                          id="phase-desc"
                          placeholder="Deskripsi fase pembelajaran"
                          value={phaseForm.description}
                          onChange={(e) =>
                            setPhaseForm({
                              ...phaseForm,
                              description: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {activeTab === "outcomes" && (
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>Fase *</Label>
                        <Select
                          value={outcomeForm.phaseId}
                          onValueChange={(val) =>
                            setOutcomeForm({ ...outcomeForm, phaseId: val })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih fase" />
                          </SelectTrigger>
                          <SelectContent>
                            {phases?.map((phase) => (
                              <SelectItem key={phase.id} value={phase.id}>
                                {phase.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Mata Pelajaran *</Label>
                        <Select
                          value={outcomeForm.subjectId}
                          onValueChange={(val) =>
                            setOutcomeForm({ ...outcomeForm, subjectId: val })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih mata pelajaran" />
                          </SelectTrigger>
                          <SelectContent>
                            {subjects?.map((subject) => (
                              <SelectItem key={subject.id} value={subject.id}>
                                {subject.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="outcome-code">Kode CP *</Label>
                        <Input
                          id="outcome-code"
                          placeholder="IND.A.1"
                          value={outcomeForm.code}
                          onChange={(e) =>
                            setOutcomeForm({
                              ...outcomeForm,
                              code: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="outcome-desc">Deskripsi CP *</Label>
                        <Textarea
                          id="outcome-desc"
                          placeholder="Deskripsi capaian pembelajaran"
                          value={outcomeForm.description}
                          onChange={(e) =>
                            setOutcomeForm({
                              ...outcomeForm,
                              description: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {activeTab === "p5" && (
                    <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
                      <div className="grid gap-2">
                        <Label>Tahun Ajaran *</Label>
                        <Select
                          value={projectForm.academicYearId}
                          onValueChange={(val) =>
                            setProjectForm({
                              ...projectForm,
                              academicYearId: val,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih tahun ajaran" />
                          </SelectTrigger>
                          <SelectContent>
                            {academicYears?.data?.map((year) => (
                              <SelectItem key={year.id} value={year.id}>
                                {year.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Unit *</Label>
                        <Select
                          value={projectForm.unitId}
                          onValueChange={(val) =>
                            setProjectForm({ ...projectForm, unitId: val })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih unit" />
                          </SelectTrigger>
                          <SelectContent>
                            {units?.map((unit) => (
                              <SelectItem key={unit.id} value={unit.id}>
                                {unit.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Tema P5 *</Label>
                        <Select
                          value={projectForm.themeId}
                          onValueChange={(val) =>
                            setProjectForm({ ...projectForm, themeId: val })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih tema" />
                          </SelectTrigger>
                          <SelectContent>
                            {p5Themes?.map((theme: P5ThemeData) => (
                              <SelectItem key={theme.id} value={theme.id}>
                                {theme.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Pembimbing/Supervisor *</Label>
                        <Select
                          value={projectForm.supervisorId}
                          onValueChange={(val) =>
                            setProjectForm({
                              ...projectForm,
                              supervisorId: val,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih pembimbing" />
                          </SelectTrigger>
                          <SelectContent>
                            {employeesData?.data?.map((emp) => (
                              <SelectItem key={emp.id} value={emp.id}>
                                {emp.user?.name || emp.fullName || emp.nip}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="project-title">Judul Proyek *</Label>
                        <Input
                          id="project-title"
                          placeholder="Judul proyek P5"
                          value={projectForm.title}
                          onChange={(e) =>
                            setProjectForm({
                              ...projectForm,
                              title: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="project-desc">Deskripsi *</Label>
                        <Textarea
                          id="project-desc"
                          placeholder="Deskripsi proyek"
                          value={projectForm.description}
                          onChange={(e) =>
                            setProjectForm({
                              ...projectForm,
                              description: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Dimensi P5 *</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {P5_DIMENSIONS.map((dim) => (
                            <label
                              key={dim.value}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={projectForm.dimensions.includes(
                                  dim.value,
                                )}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setProjectForm({
                                      ...projectForm,
                                      dimensions: [
                                        ...projectForm.dimensions,
                                        dim.value,
                                      ],
                                    });
                                  } else {
                                    setProjectForm({
                                      ...projectForm,
                                      dimensions: projectForm.dimensions.filter(
                                        (d) => d !== dim.value,
                                      ),
                                    });
                                  }
                                }}
                                className="rounded"
                              />
                              <span className="line-clamp-1">{dim.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="project-start">Tanggal Mulai *</Label>
                          <Input
                            id="project-start"
                            type="date"
                            value={projectForm.startDate}
                            onChange={(e) =>
                              setProjectForm({
                                ...projectForm,
                                startDate: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="project-end">Tanggal Selesai *</Label>
                          <Input
                            id="project-end"
                            type="date"
                            value={projectForm.endDate}
                            onChange={(e) =>
                              setProjectForm({
                                ...projectForm,
                                endDate: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsAddDialogOpen(false)}
                    >
                      Batal
                    </Button>
                    <Button
                      onClick={handleAdd}
                      disabled={
                        createPhase.isPending ||
                        createOutcome.isPending ||
                        createProject.isPending
                      }
                    >
                      {createPhase.isPending ||
                      createOutcome.isPending ||
                      createProject.isPending
                        ? "Menyimpan..."
                        : "Simpan"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="phases" className="gap-2">
                <Layers className="h-4 w-4" />
                Fase Pembelajaran
              </TabsTrigger>
              <TabsTrigger value="outcomes" className="gap-2">
                <Target className="h-4 w-4" />
                Capaian Pembelajaran
              </TabsTrigger>
              <TabsTrigger value="p5" className="gap-2">
                <Leaf className="h-4 w-4" />
                Proyek P5
              </TabsTrigger>
            </TabsList>

            {/* Filter Bar */}
            {activeTab === "outcomes" && (
              <div className="mb-4 flex gap-2">
                <Select value={selectedPhase} onValueChange={setSelectedPhase}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Filter by Fase" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Semua Fase</SelectItem>
                    {phases?.map((phase) => (
                      <SelectItem key={phase.id} value={phase.id}>
                        {phase.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPhase && (
                  <Button
                    variant="outline"
                    onClick={() => setSelectedPhase("")}
                  >
                    Reset Filter
                  </Button>
                )}
              </div>
            )}

            {activeTab === "p5" && (
              <div className="mb-4 flex gap-2">
                <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Semua Unit</SelectItem>
                    {units?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedTheme} onValueChange={setSelectedTheme}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Filter Tema" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Semua Tema</SelectItem>
                    {p5Themes?.map((theme: P5ThemeData) => (
                      <SelectItem key={theme.id} value={theme.id}>
                        {theme.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(selectedUnit || selectedTheme) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedUnit("");
                      setSelectedTheme("");
                    }}
                  >
                    Reset Filter
                  </Button>
                )}
              </div>
            )}

            <TabsContent value="phases">
              <DataTable
                columns={phaseColumns}
                data={phases || []}
                isLoading={loadingPhases}
              />
            </TabsContent>

            <TabsContent value="outcomes">
              <DataTable
                columns={outcomeColumns}
                data={outcomes || []}
                isLoading={loadingOutcomes}
              />
            </TabsContent>

            <TabsContent value="p5">
              {loadingProjects ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-[200px] rounded-xl bg-muted animate-pulse"
                    />
                  ))}
                </div>
              ) : projects.length > 0 ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {projects.map((project) => {
                    const statusData = PROJECT_STATUSES.find(
                      (s) => s.value === project.status,
                    );
                    const themeName = project.theme?.name || "-";
                    const startDate = project.startDate
                      ? new Date(project.startDate).toLocaleDateString(
                          "id-ID",
                          { day: "numeric", month: "short" },
                        )
                      : "-";
                    const endDate = project.endDate
                      ? new Date(project.endDate).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "-";

                    return (
                      <div
                        key={project.id}
                        className="group relative flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/50"
                      >
                        <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              router.push(
                                `/curriculum/merdeka/p5/${project.id}`,
                              )
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteId(project.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <div className="mb-2 flex items-center justify-between">
                              <Badge
                                variant="outline"
                                className="line-clamp-1 max-w-[70%]"
                              >
                                {project.unit?.name}
                              </Badge>
                              <Badge className={statusData?.color}>
                                {statusData?.label}
                              </Badge>
                            </div>
                            <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">
                              {project.title}
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {project.description}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Tema
                            </div>
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <Leaf className="h-4 w-4 text-green-600" />
                              <span className="line-clamp-1">{themeName}</span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Dimensi ({project.dimensions?.length || 0})
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {project.dimensions?.slice(0, 3).map((dim) => (
                                <Badge
                                  key={dim}
                                  variant="secondary"
                                  className="text-[10px] px-1.5 h-5"
                                >
                                  {P5_DIMENSIONS.find((d) => d.value === dim)
                                    ?.label || dim}
                                </Badge>
                              ))}
                              {(project.dimensions?.length || 0) > 3 && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] px-1.5 h-5"
                                >
                                  +{(project.dimensions?.length || 0) - 3}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-6 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>
                              {startDate} - {endDate}
                            </span>
                          </div>
                          <div
                            className="flex items-center gap-1.5"
                            title="Jumlah Siswa"
                          >
                            <Users className="h-3.5 w-3.5" />
                            <span>{project._count?.assessments || 0}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-muted/50 p-4 mb-4">
                    <Leaf className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold text-lg">Belum ada Proyek P5</h3>
                  <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                    Mulai buat proyek penguatan profil pelajar pancasila untuk
                    unit ini.
                  </p>
                  <Button
                    onClick={() => {
                      setActiveTab("p5");
                      setIsAddDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Buat Proyek Baru
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title={`Hapus ${getTabLabel()}`}
        description={`Apakah Anda yakin ingin menghapus ${getTabLabel().toLowerCase()} ini?`}
        onConfirm={handleDelete}
        isLoading={deleteOutcome.isPending || deleteProject.isPending}
      />
    </MainLayout>
  );
}
