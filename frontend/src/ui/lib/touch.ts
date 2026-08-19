export const isHoveringPointer = (event: { pointerType: string; buttons: number }) =>
  event.pointerType !== "touch" && event.buttons === 0;
