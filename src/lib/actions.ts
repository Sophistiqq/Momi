import type { Action } from 'svelte/action';

// Svelte action: call `onOutside` when a click lands outside `node`.
export const clickOutside: Action<HTMLElement, () => void> = (node, onOutside) => {
  const handler = (e: Event) => {
    if (onOutside && !node.contains(e.target as Node)) onOutside();
  };
  document.addEventListener('click', handler, true);
  return {
    destroy() {
      document.removeEventListener('click', handler, true);
    },
  };
};
