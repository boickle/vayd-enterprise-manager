import { useEffect, useState } from 'react';
import {
  readStoreCart,
  readStoreGiftCart,
  STORE_CART_EVENT,
  type StoreCartLine,
  type StoreGiftCardLine,
} from './storeCartState';

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

export function useStoreGiftCart(): StoreGiftCardLine[] {
  const [lines, setLines] = useState<StoreGiftCardLine[]>(() => readStoreGiftCart());

  useEffect(() => {
    const sync = () => setLines(readStoreGiftCart());
    window.addEventListener(STORE_CART_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(STORE_CART_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return lines;
}
