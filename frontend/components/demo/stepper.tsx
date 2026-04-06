"use client";

import { Check, KeyRound, Upload, Crop, Ruler, Brain, BarChart3, PenSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

const ALL_STEP_ICONS = [KeyRound, Upload, Crop, Ruler, Brain, BarChart3, PenSquare];
const ALL_STEP_KEYS: DTKey[] = ["st_connect", "st_upload", "st_crop", "st_scale", "st_analyze", "st_results", "st_editor"];

// Non-admin: skip Connect step (index 0)
const USER_STEP_ICONS = [Upload, Crop, Ruler, Brain, BarChart3, PenSquare];
const USER_STEP_KEYS: DTKey[] = ["st_upload", "st_crop", "st_scale", "st_analyze", "st_results", "st_editor"];

interface StepperProps {
  currentStep: number;   // 1-based (internal step number)
  totalSteps?: number;
  skipConnect?: boolean; // true for non-admin users
  onStepClick?: (internalStep: number) => void; // callback when a completed step is clicked
}

export default function Stepper({ currentStep, totalSteps, skipConnect, onStepClick }: StepperProps) {
  const { lang } = useLang();

  const icons = skipConnect ? USER_STEP_ICONS : ALL_STEP_ICONS;
  const keys = skipConnect ? USER_STEP_KEYS : ALL_STEP_KEYS;
  const count = Math.min(totalSteps ?? icons.length, icons.length);

  // When skipConnect, internal step 2 maps to visual step 1
  const visualStep = skipConnect ? currentStep - 1 : currentStep;

  const handleClick = (visualStepNum: number) => {
    if (!onStepClick) return;
    const internalStep = skipConnect ? visualStepNum + 1 : visualStepNum;
    onStepClick(internalStep);
  };

  return (
    <div className="flex items-center w-full max-w-3xl mx-auto px-2">
      {Array.from({ length: count }).map((_, index) => {
        const stepNum = index + 1;
        const isActive = stepNum === visualStep;
        const isDone = stepNum < visualStep;
        const isLast = index === count - 1;
        const Icon = icons[index];
        const label = dt(keys[index], lang);
        const isClickable = isDone && !!onStepClick;

        return (
          <div key={index} className={cn("flex items-center", isLast ? "flex-shrink-0" : "flex-1")}>
            {/* Step circle + label */}
            <div
              className={cn(
                "flex flex-col items-center gap-1 flex-shrink-0 relative",
                isClickable && "cursor-pointer group"
              )}
              onClick={isClickable ? () => handleClick(stepNum) : undefined}
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 relative",
                  isActive && "bg-gradient-to-br from-cyan-400 to-sky-600 text-white shadow-[0_0_20px_rgba(34,211,238,0.35)]",
                  isDone && "bg-emerald-500/15 border-[1.5px] border-emerald-500/40 text-emerald-400",
                  !isActive && !isDone && "bg-white/[0.04] border-[1.5px] border-white/[0.08] text-slate-500",
                  isClickable && "group-hover:border-emerald-400/60 group-hover:scale-110 group-hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                )}
              >
                {isDone ? (
                  <Check className="w-4 h-4" strokeWidth={2.5} />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-semibold transition-colors hidden sm:block whitespace-nowrap max-w-[72px] truncate text-center",
                  isActive && "text-cyan-300",
                  isDone && "text-emerald-400/80",
                  !isActive && !isDone && "text-slate-600",
                  isClickable && "group-hover:text-emerald-300"
                )}
              >
                {label}
              </span>
            </div>
            {/* Connector line */}
            {!isLast && (
              <div className="flex-1 flex items-center px-1.5 -mt-4 sm:-mt-4">
                <div
                  className={cn(
                    "h-[2px] w-full rounded-full transition-all duration-500",
                    isDone
                      ? "bg-gradient-to-r from-emerald-500/50 to-emerald-500/20"
                      : isActive
                        ? "bg-gradient-to-r from-cyan-500/30 to-transparent"
                        : "bg-white/[0.04]"
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
