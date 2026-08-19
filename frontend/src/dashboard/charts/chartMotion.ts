export const CHART_FOCUS_OPACITY = 0.22;
export const CHART_FOCUS_TRANSITION = { duration: 0.18 } as const;

export function focusOpacity(focusedId: string | null, id: string): number {
  return focusedId === null || focusedId === id ? 1 : CHART_FOCUS_OPACITY;
}
