"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/shared/utils/cn";

/**
 * Toast notification system.
 *
 * The design brief asks for a Sonner-based toast. This environment has no
 * registry access to install new npm packages, so — consistent with the
 * rest of `ui/` (`Dialog`, `Tabs`, `Select`, `Popover`, `DropdownMenu`
 * all deliberately avoid adding a dependency for a self-containable
 * primitive) — this is a small dependency-free store + `<Toaster />`
 * that mirrors Sonner's call-site API (`toast()`, `toast.success()`,
 * `toast.error()`, `toast.warning()`, `toast.info()`, auto-dismiss,
 * manual dismiss). If `sonner` is added to the project later, only this
 * file and its `<Toaster />` mount in `providers.tsx` need to change —
 * every call site using `toast(...)` keeps working unmodified.
 */

export type ToastVariant = "default" | "success" | "warning" | "danger" | "info";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

type Listener = (toasts: ToastItem[]) => void;

class ToastStore {
  private toasts: ToastItem[] = [];
  private listeners = new Set<Listener>();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.toasts);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l(this.toasts));
  }

  add(title: string, opts: { description?: string; variant?: ToastVariant; duration?: number } = {}) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: ToastItem = {
      id,
      title,
      description: opts.description,
      variant: opts.variant ?? "default",
      duration: opts.duration ?? 4000,
    };
    this.toasts = [...this.toasts, item];
    this.emit();
    if (item.duration > 0) {
      setTimeout(() => this.dismiss(id), item.duration);
    }
    return id;
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }
}

const store = new ToastStore();

function toastFn(title: string, opts?: { description?: string; duration?: number }) {
  return store.add(title, { ...opts, variant: "default" });
}
toastFn.success = (title: string, opts?: { description?: string; duration?: number }) =>
  store.add(title, { ...opts, variant: "success" });
toastFn.warning = (title: string, opts?: { description?: string; duration?: number }) =>
  store.add(title, { ...opts, variant: "warning" });
toastFn.error = (title: string, opts?: { description?: string; duration?: number }) =>
  store.add(title, { ...opts, variant: "danger" });
toastFn.info = (title: string, opts?: { description?: string; duration?: number }) =>
  store.add(title, { ...opts, variant: "info" });
toastFn.dismiss = (id: string) => store.dismiss(id);

/** Call from any Client Component: `toast("Saved")`, `toast.success(...)`, `toast.error(...)`. */
export const toast = toastFn;

const icons: Record<ToastVariant, React.ElementType> = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const iconTone: Record<ToastVariant, string> = {
  default: "text-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

/** Mount once near the root (see `src/app/providers.tsx`). Renders queued toasts bottom-right via a portal. */
export function Toaster() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    return store.subscribe(setToasts);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-label="Notificaciones"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-end gap-2 p-4 sm:inset-x-auto sm:right-0"
    >
      {toasts.map((t) => {
        const Icon = icons[t.variant];
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg",
            )}
          >
            <Icon aria-hidden className={cn("mt-0.5 h-5 w-5 shrink-0", iconTone[t.variant])} />
            <div className="flex flex-1 flex-col gap-0.5">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
            </div>
            <button
              type="button"
              aria-label="Cerrar notificación"
              onClick={() => store.dismiss(t.id)}
              className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
