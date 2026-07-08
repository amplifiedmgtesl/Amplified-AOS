"use client";

// A dependency-free signature pad: an HTML canvas driven by pointer events
// (works with mouse, touch, and stylus). Exposes an imperative handle so the
// parent's "Confirm" button can pull the PNG blob and check emptiness.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type SignaturePadHandle = {
  isEmpty: () => boolean;
  clear: () => void;
  toBlob: () => Promise<Blob | null>;
};

type Props = { width?: number; height?: number };

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { width = 600, height = 220 },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Back the canvas at device-pixel resolution for crisp strokes; keep the
    // drawing coordinate system in CSS pixels via ctx.scale.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111";
    }
  }, [width, height]);

  function pos(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (width / rect.width),
      y: (e.clientY - rect.top) * (height / rect.height),
    };
  }

  function start(e: React.PointerEvent) {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    dirty.current = true;
  }

  function end() {
    drawing.current = false;
    last.current = null;
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => !dirty.current,
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty.current = false;
    },
    toBlob: () =>
      new Promise((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas) return resolve(null);
        canvas.toBlob((b) => resolve(b), "image/png");
      }),
  }));

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      style={{
        width,
        height,
        maxWidth: "100%",
        touchAction: "none",
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        background: "#fff",
        cursor: "crosshair",
        display: "block",
      }}
    />
  );
});
