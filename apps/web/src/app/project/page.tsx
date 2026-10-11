"use client";
import { MainLayout } from "@/components/layout";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateProjectModal } from "./_components/create-project-modal";

import { Badge } from "@/components/ui/badge";

function ProjectListPageContent() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await api.get("/projects");
      return res.data;
    },
  });

  if (isLoading)
    return <div className="p-8 text-center">Loading projects...</div>;

  return (
    <div className="container py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage your projects and tasks.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>Create Project</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects?.map((project: any) => (
          <Link href={`/project/${project.id}`} key={project.id}>
            <Card className="h-full hover:shadow-md transition-all cursor-pointer border-l-4 border-l-primary/50">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-xl line-clamp-1">
                    {project.name}
                  </CardTitle>
                  <Badge variant={getStatusVariant(project.status)}>
                    {formatStatus(project.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px] mb-4">
                  {project.description || "No description provided."}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t">
                  <div className="flex gap-4">
                    <span>Tasks: {project._count.tasks}</span>
                    <span>Members: {project._count.members}</span>
                  </div>
                  <span>
                    {safeFormat(new Date(project.updatedAt), "MMM d, yyyy")}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {projects?.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <p className="text-lg font-medium">No projects found</p>
            <p className="text-sm">Create your first project to get started.</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setIsCreateOpen(true)}
            >
              Create Project
            </Button>
          </div>
        )}
      </div>

      <CreateProjectModal open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}

function getStatusVariant(status: string) {
  switch (status) {
    case "PLANNING":
      return "secondary";
    case "IN_PROGRESS":
      return "default";
    case "COMPLETED":
      return "secondary"; // Using secondary for success if success not available
    case "CANCELLED":
      return "destructive";
    default:
      return "outline";
  }
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

export default function ProjectListPageWithShell() {
  return (
    <MainLayout>
      <ProjectListPageContent />
    </MainLayout>
  );
}
