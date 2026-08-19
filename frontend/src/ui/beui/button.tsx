import { Check, Loader2, X } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Variants,
} from "motion/react";
import {
  forwardRef,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "../lib/ease";
import { useHoverCapable } from "../lib/use-hover-capable";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  ripple?: boolean;
  children?: ReactNode;
}

export interface ButtonLinkProps extends Omit<HTMLMotionProps<"a">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  children?: ReactNode;
}

type Ripple = { id: number; x: number; y: number; size: number };

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-card text-foreground hover:border-border",
  ghost: "text-muted-foreground hover:bg-primary/5 hover:text-foreground",
  outline: "border border-border bg-transparent text-foreground hover:bg-primary/5",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-xs",
  md: "h-10 gap-2 rounded-full px-5 text-sm",
  lg: "h-12 gap-2 rounded-full px-6 text-base",
  icon: "h-8 w-8 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    pressScale = 0.93,
    ripple = false,
    className,
    children,
    onPointerDown,
    ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (ripple && !reduce) {
        const rect = event.currentTarget.getBoundingClientRect();
        const sizePx = Math.max(rect.width, rect.height) * 2;
        const id = nextId.current++;
        setRipples((previous) => [
          ...previous,
          {
            id,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            size: sizePx,
          },
        ]);
      }
      onPointerDown?.(event);
    },
    [onPointerDown, reduce, ripple],
  );

  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={reduce ? undefined : { scale: pressScale }}
      whileHover={reduce || !canHover ? undefined : { scale: 1.02 }}
      transition={SPRING_PRESS}
      onPointerDown={handlePointerDown}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        ripple && "relative overflow-hidden",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {ripple && !reduce ? (
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <AnimatePresence>
            {ripples.map((rippleItem) => (
              <motion.span
                key={rippleItem.id}
                className="absolute rounded-full bg-current"
                style={{
                  left: rippleItem.x,
                  top: rippleItem.y,
                  width: rippleItem.size,
                  height: rippleItem.size,
                  x: "-50%",
                  y: "-50%",
                }}
                initial={{ scale: 0.05, opacity: 0.3 }}
                animate={{ scale: 1, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.6, ease: EASE_OUT }}
                onAnimationComplete={() =>
                  setRipples((previous) => previous.filter((item) => item.id !== rippleItem.id))
                }
              />
            ))}
          </AnimatePresence>
        </span>
      ) : null}
      {children}
    </motion.button>
  );
});

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  {
    variant = "primary",
    size = "md",
    pressScale = 0.93,
    className,
    children,
    ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  return (
    <motion.a
      ref={ref}
      whileTap={reduce ? undefined : { scale: pressScale }}
      whileHover={reduce || !canHover ? undefined : { scale: 1.02 }}
      transition={SPRING_PRESS}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition-colors",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </motion.a>
  );
});

export type ButtonState = "idle" | "loading" | "success" | "error";

export interface StatefulButtonProps extends Omit<ButtonProps, "children"> {
  state?: ButtonState;
  children: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
  icon?: ReactNode;
}

const CASCADE_STAGGER = 0.025;
const ROLL_BLUR = "blur(6px)";

const CASCADE_LETTER_VARIANTS: Variants = {
  initial: { opacity: 0, y: "105%", filter: ROLL_BLUR },
  animate: (delay: number = 0) => ({
    opacity: 1,
    y: "0%",
    filter: "blur(0px)",
    transition: { ...SPRING_SWAP, delay },
  }),
  exit: (delay: number = 0) => ({
    opacity: 0,
    y: "-105%",
    filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT, delay: delay * 0.5 },
  }),
};

const ICON_VARIANTS: Variants = {
  initial: { opacity: 0, width: 0, scale: 0.7, filter: ROLL_BLUR },
  animate: {
    opacity: 1,
    width: "1.5rem",
    scale: 1,
    filter: "blur(0px)",
    transition: SPRING_SWAP,
  },
  exit: {
    opacity: 0,
    width: 0,
    scale: 0.7,
    filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT },
  },
};

function IconSlot({ keyId, children }: { keyId: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={keyId}
      variants={ICON_VARIANTS}
      initial={reduce ? { opacity: 0 } : "initial"}
      animate={reduce ? { opacity: 1 } : "animate"}
      exit={reduce ? { opacity: 0 } : "exit"}
      transition={reduce ? { duration: 0.15 } : undefined}
      className="inline-grid shrink-0 place-items-center overflow-hidden"
    >
      {children}
    </motion.span>
  );
}

function TextSlot({ value, children }: { value: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  const label = typeof children === "string" ? children : null;
  const cascade = label !== null && !reduce;

  useLayoutEffect(() => {
    const nextWidth = measureRef.current?.offsetWidth;
    if (!nextWidth) return;
    setWidth((current) => (current === nextWidth ? current : nextWidth));
  });

  return (
    <motion.span
      initial={false}
      animate={{ width }}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
      className="relative inline-block overflow-hidden whitespace-nowrap align-bottom"
    >
      <span ref={measureRef} aria-hidden className="invisible inline-block whitespace-nowrap">
        {cascade
          ? label.split("").map((char, index) => (
              <span key={`${char}-${index}`} className="inline-block whitespace-pre">
                {char}
              </span>
            ))
          : children}
      </span>
      {cascade ? (
        <>
          <span className="sr-only">{label}</span>
          <AnimatePresence initial={false}>
            <motion.span
              key={`cascade-${value}`}
              aria-hidden
              initial="initial"
              animate="animate"
              exit="exit"
              className="absolute left-0 top-0 inline-block whitespace-pre"
            >
              {label.split("").map((char, index) => (
                <motion.span
                  key={`${char}-${index}`}
                  custom={index * CASCADE_STAGGER}
                  variants={CASCADE_LETTER_VARIANTS}
                  className="inline-block whitespace-pre will-change-[opacity,filter,transform]"
                >
                  {char}
                </motion.span>
              ))}
            </motion.span>
          </AnimatePresence>
        </>
      ) : (
        <AnimatePresence initial={false}>
          <motion.span
            key={`text-${value}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, filter: ROLL_BLUR }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14, filter: ROLL_BLUR }}
            transition={reduce ? { duration: 0.15 } : SPRING_SWAP}
            className="absolute left-0 top-0 inline-block will-change-[opacity,filter,transform]"
          >
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </motion.span>
  );
}

export const StatefulButton = forwardRef<HTMLButtonElement, StatefulButtonProps>(function StatefulButton(
  {
    state = "idle",
    children,
    loadingText = "Loading",
    successText = "Done",
    errorText = "Try again",
    icon,
    disabled,
    ...rest
  },
  ref,
) {
  const isBusy = state === "loading";
  const stateText =
    state === "loading"
      ? loadingText
      : state === "success"
        ? successText
        : state === "error"
          ? errorText
          : children;
  const textKey = typeof stateText === "string" ? `${state}-${stateText}` : state;

  return (
    <Button ref={ref} disabled={disabled || isBusy} aria-busy={isBusy} whileHover={undefined} {...rest}>
      <span aria-live="polite" className="relative inline-flex items-center justify-center overflow-hidden">
        <AnimatePresence initial={false}>
          {state === "loading" ? (
            <IconSlot keyId="loading-icon">
              <Loader2 className="h-4 w-4 animate-spin" />
            </IconSlot>
          ) : null}
          {state === "success" ? (
            <IconSlot keyId="success-icon">
              <Check className="h-4 w-4" />
            </IconSlot>
          ) : null}
          {state === "error" ? (
            <IconSlot keyId="error-icon">
              <X className="h-4 w-4" />
            </IconSlot>
          ) : null}
        </AnimatePresence>
        <TextSlot value={textKey}>{stateText}</TextSlot>
        <AnimatePresence initial={false}>
          {state === "idle" && icon ? <IconSlot keyId="idle-icon">{icon}</IconSlot> : null}
        </AnimatePresence>
      </span>
    </Button>
  );
});
