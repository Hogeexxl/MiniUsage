export const CHART_FOCUS_OPACITY = 0.22;

export function focusOpacity(focusedId: string | null, id: string): number {
  return focusedId === null || focusedId === id ? 1 : CHART_FOCUS_OPACITY;
}
