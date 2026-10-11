"use client";
import { useQuery } from "@tanstack/react-query";
import { safeFormat } from "@/lib/date";
import { api } from "@/lib/api";
import { useParams } from "next/navigation";
import { KanbanBoard } from "../_components/kanban-board";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { MainLayout } from "@/components/layout";
function ProjectDetailPageContent() {
  const params = useParams();
  const projectId = params.id as string;

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await api.get(`/projects/${projectId}`);
      return res.data;
    },
  });

  if (isLoading)
    return <div className="p-8 text-center">Loading project...</div>;
  if (!project) return <div className="p-8 text-center">Project not found</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex-none p-6 border-b bg-card">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/project">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-sm text-muted-foreground">
              {project.description} • Due{" "}
              {project.endDate
                ? safeFormat(new Date(project.endDate), "MMM d, yyyy")
                : "No due date"}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-6 bg-muted/20">
        <KanbanBoard project={project} />
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  return (
    <MainLayout>
      <ProjectDetailPageContent />
    </MainLayout>
  );
}
