/**
 * Expanding content under a focused button makes the browser scroll that button
 * back into view. Capture scroll, blur, toggle, then restore.
 */
export function toggleWithoutScrollJump(button: HTMLElement, toggle: () => void): void {
  let scroller: HTMLElement | null = null;
  let node: Element | null = button;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      const { overflowY } = getComputedStyle(node);
      if (
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        node.scrollHeight > node.clientHeight + 1
      ) {
        scroller = node;
        break;
      }
    }
    node = node.parentElement;
  }
  if (!scroller) {
    scroller = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  }
  const top = scroller.scrollTop;
  button.blur();
  toggle();
  requestAnimationFrame(() => {
    scroller!.scrollTop = top;
  });
}
