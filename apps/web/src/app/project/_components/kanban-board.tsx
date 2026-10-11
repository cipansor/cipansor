"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { ProjectColumn } from "./project-column";
import { TaskCard } from "./task-card";
import { CreateTaskModal } from "./create-task-modal";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Props {
  project: any;
}

export function KanbanBoard({ project }: Props) {
  const queryClient = useQueryClient();
  const [columns, setColumns] = useState(project.columns);
  const [activeTask, setActiveTask] = useState<any>(null);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);

  useEffect(() => {
    setTimeout(() => setColumns(project.columns), 0);
  }, [project.columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const moveTaskMutation = useMutation({
    mutationFn: async (data: {
      taskId: string;
      columnId: string;
      order: number;
    }) => {
      await api.patch(`/projects/tasks/${data.taskId}/position`, {
        columnId: data.columnId,
        order: data.order,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
    },
  });

  function onDragStart(event: DragStartEvent) {
    const { active } = event;
    const taskId = active.id as string;
    // Find task in columns
    for (const col of columns) {
      const task = col.tasks.find((t: any) => t.id === taskId);
      if (task) {
        setActiveTask(task);
        break;
      }
    }
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    // Find containers
    const activeCol = findColumn(activeId as string);
    const overCol = findColumn(overId as string);

    if (!activeCol || !overCol) return;

    if (activeCol !== overCol) {
      // Moving between columns
      setColumns((prev: any) => {
        const activeColumnIndex = prev.findIndex(
          (col: any) => col.id === activeCol.id,
        );
        const overColumnIndex = prev.findIndex(
          (col: any) => col.id === overCol.id,
        );

        const activeColumn = prev[activeColumnIndex];
        const overColumn = prev[overColumnIndex];

        const activeTaskIndex = activeColumn.tasks.findIndex(
          (t: any) => t.id === activeId,
        );
        // If dropping on a task, get its index, else append
        const overTaskIndex = overColumn.tasks.findIndex(
          (t: any) => t.id === overId,
        );

        const newIndex =
          overTaskIndex >= 0 ? overTaskIndex : overColumn.tasks.length + 1;

        // Clone to avoid mutation
        const newColumns = JSON.parse(JSON.stringify(prev));

        const [movedTask] = newColumns[activeColumnIndex].tasks.splice(
          activeTaskIndex,
          1,
        );
        movedTask.columnId = overCol.id;
        newColumns[overColumnIndex].tasks.splice(newIndex, 0, movedTask);

        return newColumns;
      });
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeId = active.id as string;

    // Trigger API update
    const finalCol = columns.find((col: any) =>
      col.tasks.some((t: any) => t.id === activeId),
    );
    if (finalCol) {
      const taskIndex = finalCol.tasks.findIndex((t: any) => t.id === activeId);
      moveTaskMutation.mutate({
        taskId: activeId,
        columnId: finalCol.id,
        order: taskIndex,
      });
    }
  }

  function findColumn(id: string) {
    if (columns.some((col: any) => col.id === id)) {
      return columns.find((col: any) => col.id === id);
    }
    return columns.find((col: any) => col.tasks.some((t: any) => t.id === id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-4 h-full items-start">
        {columns.map((col: any) => (
          <ProjectColumn
            key={col.id}
            column={col}
            onAddTask={() => {
              setActiveColumnId(col.id);
              setIsCreateTaskOpen(true);
            }}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} /> : null}
      </DragOverlay>

      <CreateTaskModal
        open={isCreateTaskOpen}
        onOpenChange={setIsCreateTaskOpen}
        projectId={project.id}
        columnId={activeColumnId}
      />
    </DndContext>
  );
}
