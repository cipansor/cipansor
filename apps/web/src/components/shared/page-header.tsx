"use client";

import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft, ChevronRight, Home } from "lucide-react";
import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string | React.ReactNode;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?:
    | {
        label: string;
        href?: string;
        onClick?: () => void;
        icon?: React.ReactNode;
      }
    | React.ReactNode;
  backHref?: string;
  backLabel?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  action,
  actions,
  backHref,
  backLabel,
  breadcrumbs,
  children,
}: PageHeaderProps) {
  const isActionObject =
    action && typeof action === "object" && "label" in action;

  return (
    <div className="mb-6">
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Jejak halaman"
          className="flex items-center gap-1 text-sm text-muted-foreground mb-3"
        >
          <Link
            href="/dashboard"
            aria-label="Beranda"
            className="hover:text-foreground"
          >
            <Home className="h-4 w-4" aria-hidden />
          </Link>
          {breadcrumbs.map((item, index) => (
            <span key={index} className="flex items-center gap-1">
              <ChevronRight className="h-4 w-4" />
              {item.href ? (
                <Link href={item.href} className="hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span className="text-foreground font-medium">
                  {item.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Header Content */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {backHref && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={backHref}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                {backLabel || "Kembali"}
              </Link>
            </Button>
          )}
          {Icon && (
            <div className="hidden md:flex h-12 w-12 items-center justify-center rounded-lg border bg-card text-card-foreground shadow-sm">
              <Icon className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {description && (
              <p className="text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {children}
          {isActionObject ? (
            (
              action as {
                label: string;
                href?: string;
                onClick?: () => void;
                icon?: React.ReactNode;
              }
            ).href ? (
              <Button asChild>
                <Link href={(action as { href: string }).href}>
                  {(action as { icon?: React.ReactNode }).icon || (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {(action as { label: string }).label}
                </Link>
              </Button>
            ) : (
              <Button onClick={(action as { onClick?: () => void }).onClick}>
                {(action as { icon?: React.ReactNode }).icon || (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {(action as { label: string }).label}
              </Button>
            )
          ) : (
            action
          )}
        </div>
      </div>
    </div>
  );
}
