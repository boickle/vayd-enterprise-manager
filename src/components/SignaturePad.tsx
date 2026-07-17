import { useEffect, useRef, useState } from 'react';

type Props = {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  label?: string;
};

/** Simple canvas signature pad — outputs a PNG data URL. */
export function SignaturePad({ value, onChange, disabled, label = 'Signed,' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        setHasStroke(true);
      };
      img.src = value;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- init once

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasStroke(false);
    onChange(null);
  }

  return (
    <div className="euth-sig">
      <label className="euth-label">{label}</label>
      <canvas
        ref={canvasRef}
        className="euth-sig__canvas"
        style={{ touchAction: 'none', opacity: disabled ? 0.6 : 1 }}
        onPointerDown={(e) => {
          if (disabled) return;
          drawing.current = true;
          const ctx = canvasRef.current?.getContext('2d');
          if (!ctx) return;
          const p = pointFromEvent(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || disabled) return;
          const ctx = canvasRef.current?.getContext('2d');
          if (!ctx) return;
          const p = pointFromEvent(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          setHasStroke(true);
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (hasStroke) emit();
          else {
            // last stroke may have just set hasStroke asynchronously — emit anyway if path drawn
            emit();
          }
        }}
        onPointerLeave={() => {
          if (drawing.current) {
            drawing.current = false;
            emit();
          }
        }}
      />
      <div className="euth-sig__actions">
        <button type="button" className="euth-btn euth-btn--ghost" onClick={clear} disabled={disabled}>
          Clear signature
        </button>
      </div>
    </div>
  );
}
