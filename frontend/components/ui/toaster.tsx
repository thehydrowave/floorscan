"use client";

import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, variant, action, ...props }) => (
        <Toast key={id} variant={variant} {...props}>
          <div className="flex gap-3 items-start w-full">
            {variant === "success" && (
              <CheckCircle2 className="h-4 w-4 text-accent-green shrink-0 mt-0.5" />
            )}
            {variant === "error" && (
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            )}
            {variant === "default" && (
              <Info className="h-4 w-4 text-brand-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </div>
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
