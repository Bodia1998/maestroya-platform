"use client";

import * as React from "react";

import { cn } from "@/shared/utils/cn";

interface RadioGroupContextValue {
  name: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

/** Groups `RadioGroupItem`s under one `name` — a thin context wrapper around native radio inputs. */
export function RadioGroup({ name, value, onValueChange, className, children, ...props }: RadioGroupProps) {
  return (
    <RadioGroupContext.Provider value={{ name, value, onValueChange }}>
      <div role="radiogroup" className={cn("flex flex-col gap-2.5", className)} {...props}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export interface RadioGroupItemProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "name" | "size"> {
  value: string;
}

export const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
  ({ className, value, ...props }, ref) => {
    const ctx = React.useContext(RadioGroupContext);
    if (!ctx) throw new Error("RadioGroupItem must be used inside <RadioGroup>");
    return (
      <span className={cn("relative inline-flex h-5 w-5 shrink-0 items-center justify-center", className)}>
        <input
          ref={ref}
          type="radio"
          name={ctx.name}
          value={value}
          checked={ctx.value !== undefined ? ctx.value === value : undefined}
          onChange={(e) => {
            props.onChange?.(e);
            ctx.onValueChange?.(value);
          }}
          className="peer absolute inset-0 h-5 w-5 cursor-pointer appearance-none rounded-full border border-input bg-background shadow-xs transition-colors checked:border-primary hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <span className="pointer-events-none relative h-2.5 w-2.5 scale-0 rounded-full bg-primary transition-transform peer-checked:scale-100" />
      </span>
    );
  },
);
RadioGroupItem.displayName = "RadioGroupItem";
