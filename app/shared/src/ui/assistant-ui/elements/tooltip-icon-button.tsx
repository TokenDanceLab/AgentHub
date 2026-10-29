"use client";

import { useAssistantText } from "../text";

import { type ComponentPropsWithRef, forwardRef } from "react";
import { Slot } from "radix-ui";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../shadcn/ui/tooltip";
import { Button } from "../../../shadcn/ui/button";
import { cn } from "../../../lib/utils";

export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(({ children, tooltip, side = "bottom", className, ...rest }, ref) => {
  const t = useAssistantText();
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            {...rest}
            className={cn(
              "aui-button-icon size-6 p-1 active:scale-90",
              className,
            )}
            ref={ref}
          >
            <Slot.Slottable>{children}</Slot.Slottable>
            <span className="aui-sr-only sr-only">{t(tooltip)}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side}>{t(tooltip)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

TooltipIconButton.displayName = "TooltipIconButton";
