"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/shared/utils/cn";
import { Input, type InputProps } from "./input";

export interface PasswordInputProps extends Omit<InputProps, "type"> {
  /** Accessible label for the show/hide toggle button. */
  toggleLabel?: { show: string; hide: string };
}

/** `Input` with a show/hide toggle. Client Component — the toggle is local UI state. */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, toggleLabel = { show: "Mostrar contraseña", hide: "Ocultar contraseña" }, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-11", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? toggleLabel.hide : toggleLabel.show}
          aria-pressed={visible}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
