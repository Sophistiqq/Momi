// Svelte action: call `onOutside` when a click lands outside `node`.
export function clickOutside(node, onOutside) {
  const handler = (e) => {
    if (!node.contains(e.target)) onOutside();
  };
  document.addEventListener('click', handler, true);
  return {
    destroy() {
      document.removeEventListener('click', handler, true);
    },
  };
}
