import { useEffect, useRef } from 'react';
import styles from './ParticleCanvas.module.css';

interface Particle {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  hue: number;
  alpha: number;
}

/**
 * Animated floating particle canvas background.
 * Renders 56 blue/cyan particles with subtle connector lines.
 * This is a pure visual effect — no user interaction.
 */
export function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const particleCount = 56;
    let particles: Particle[] = [];
    let frameId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = Array.from({ length: particleCount }, (_, i): Particle => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 1.6 + Math.random() * 2.6,
        vx: -0.18 + Math.random() * 0.36,
        vy: -0.18 - Math.random() * 0.48,
        hue: i % 3 === 0 ? 196 : 210,
        alpha: 0.18 + Math.random() * 0.2,
      }));
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i]!;
        p.x += p.vx;
        p.y += p.vy;

        if (p.y < -16) {
          p.y = height + 16;
          p.x = Math.random() * width;
        }
        if (p.x < -16) p.x = width + 16;
        if (p.x > width + 16) p.x = -16;

        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 84%, 48%, ${p.alpha})`;
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < particles.length; j += 1) {
          const n = particles[j]!;
          const dx = p.x - n.x;
          const dy = p.y - n.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 126) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(23, 105, 232, ${(1 - distance / 126) * 0.07})`;
            ctx.lineWidth = 1;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(n.x, n.y);
            ctx.stroke();
          }
        }
      }

      frameId = window.requestAnimationFrame(animate);
    };

    resize();
    animate();
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
