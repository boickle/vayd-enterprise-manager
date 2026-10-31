import { useEffect, useState } from 'react';

/** Desktop browsers ignore `capture` and open a file picker instead. */
export function deviceOpensCamera(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return false;
  if (navigator.maxTouchPoints < 1) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function useCameraCaptureAvailable(): boolean {
  const [available, setAvailable] = useState(deviceOpensCamera);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setAvailable(deviceOpensCamera());
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return available;
}
