import { useEffect, useState } from 'react';
import { readStoreCart, STORE_CART_EVENT, type StoreCartLine } from './storeCartState';

export function useStoreCart(): StoreCartLine[] {
  const [lines, setLines] = useState<StoreCartLine[]>(() => readStoreCart());

  useEffect(() => {
    const sync = () => setLines(readStoreCart());
    window.addEventListener(STORE_CART_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(STORE_CART_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return lines;
}
