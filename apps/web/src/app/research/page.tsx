"use client";
import { MainLayout } from "@/components/layout";

import { useResearchThemes } from "@/hooks/research/use-research";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FlaskConical } from "lucide-react";
import Link from "next/link";

function ResearchPageContent() {
  const { data: themes, isLoading } = useResearchThemes();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Research Portal (Fathul Kutub)</h1>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : !themes?.length ? (
        <EmptyState
          icon={FlaskConical}
          title="Belum ada tema penelitian"
          description="Tema penelitian (Fathul Kutub) yang dibuka akan tampil di sini."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {themes.map((theme) => (
            <Card key={theme.id} className="flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <Badge variant="outline">{theme.category}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {theme._count.submissions} submissions
                  </span>
                </div>
                <CardTitle className="mt-2">{theme.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                  {theme.description}
                </p>
                <Link
                  href={`/research/themes/${theme.id}`}
                  className="w-full inline-block text-center bg-secondary text-secondary-foreground px-4 py-2 rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Join Research
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResearchPageWithShell() {
  return (
    <MainLayout>
      <ResearchPageContent />
    </MainLayout>
  );
}
