/** Prefix on every tab title outside production, so a test tab stands out among open tabs. */
export const NON_PROD_TITLE_PREFIX = 'TEST · ';

export function withNonProdTitlePrefix(title: string): string {
  return title.startsWith(NON_PROD_TITLE_PREFIX) ? title : `${NON_PROD_TITLE_PREFIX}${title}`;
}

/**
 * Keep the prefix on the tab title, including after a page sets its own title.
 * Returns a function that stops watching and restores the plain title.
 */
export function keepNonProdTitlePrefix(doc: Document = document): () => void {
  const apply = () => {
    const next = withNonProdTitlePrefix(doc.title);
    if (next !== doc.title) doc.title = next;
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(doc.head, { subtree: true, childList: true, characterData: true });
  return () => {
    observer.disconnect();
    if (doc.title.startsWith(NON_PROD_TITLE_PREFIX)) {
      doc.title = doc.title.slice(NON_PROD_TITLE_PREFIX.length);
    }
  };
}
