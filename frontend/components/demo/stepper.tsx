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
    // Convert visual step back to internal step
    const internalStep = skipConnect ? visualStepNum + 1 : visualStepNum;
    onStepClick(internalStep);
  };

  return (
    <div className="flex items-center w-full max-w-3xl mx-auto">
      {Array.from({ length: count }).map((_, index) => {
        const stepNum = index + 1;
        const isActive = stepNum === visualStep;
        const isDone = stepNum < visualStep;
        const isLast = index === count - 1;
        const Icon = icons[index];
        const label = dt(keys[index], lang);
        const isClickable = isDone && !!onStepClick;

        return (
          <div key={index} className="flex items-center flex-1">
            <div
              className={cn(
                "flex flex-col items-center gap-1.5 flex-shrink-0",
                isClickable && "cursor-pointer group"
              )}
              onClick={isClickable ? () => handleClick(stepNum) : undefined}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-600 font-display transition-all duration-300",
                  isActive && "step-active text-white",
                  isDone && "step-done text-accent-green",
                  !isActive && !isDone && "step-inactive text-slate-500",
                  isClickable && "group-hover:ring-2 group-hover:ring-accent-green/40 group-hover:scale-110"
                )}
              >
                {isDone ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium transition-colors hidden sm:block",
                  isActive && "text-white",
                  isDone && "text-accent-green",
                  !isActive && !isDone && "text-slate-600",
                  isClickable && "group-hover:text-white"
                )}
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div
                className={cn(
                  "flex-1 h-px mx-2 transition-colors duration-300 -mt-5 sm:-mt-5",
                  isDone ? "bg-accent-green/40" : "bg-white/5"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
