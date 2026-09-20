import React, { useEffect, useRef } from 'react';

export default function CoutureSparkles({ theme }) {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    // Handle high DPI displays
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Particle system: low density, 32 emerald-on-theme sparkles
    const PARTICLE_COUNT = 32;
    const particles = [];

    const createParticle = (isLarge = false, initRandomY = false) => {
      let size, baseOpacity, type;
      
      if (!isLarge) {
        // Tiny emerald particles (1-2px) — 28 of the 32
        size = 1.0 + Math.random() * 1.0;
        baseOpacity = 0.10 + Math.random() * 0.06; // 0.10 to 0.16
        type = Math.random() < 0.65 ? 'bokeh' : 'diamond';
      } else {
        // Larger emerald sparkles (3-4px) — the remaining 4
        size = 3.0 + Math.random() * 1.0;
        baseOpacity = 0.13 + Math.random() * 0.06; // 0.13 to 0.19
        type = Math.random() < 0.5 ? 'four-point' : 'diamond';
      }

      // Emerald family only — the reference has no blue. Three steps of one hue;
      // the whole layer is dialled right down in App.jsx, so this reads as paper
      // texture rather than decoration.
      const colorRand = Math.random();
      let color;
      if (colorRand < 0.60) {
        // Accent emerald (#009865)
        color = { r: 0, g: 152, b: 101 };
      } else if (colorRand < 0.85) {
        // Deep emerald (#007A55)
        color = { r: 0, g: 122, b: 85 };
      } else {
        // Mint highlight (#4FC79B)
        color = { r: 79, g: 199, b: 155 };
      }

      return {
        isLarge,
        x: Math.random() * canvas.clientWidth,
        y: initRandomY ? Math.random() * canvas.clientHeight : canvas.clientHeight + 10,
        size,
        type,
        color,
        vx: (Math.random() - 0.5) * 0.05, // Extremely slow drift
        vy: -0.03 - Math.random() * 0.05, // Slow float up
        opacity: baseOpacity,
        baseOpacity,
        twinkleSpeed: 0.004 + Math.random() * 0.01,
        phase: Math.random() * Math.PI * 2
      };
    };

    // Instantiate particles (only 4-5 larger ones)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const isLarge = i < 4; // 4 larger ones, 28 tiny ones
      particles.push(createParticle(isLarge, true));
    }

    // Parallax mouse listeners
    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.targetX = e.clientX - rect.left - rect.width / 2;
      mouseRef.current.targetY = e.clientY - rect.top - rect.height / 2;
    };

    const handleMouseLeave = () => {
      mouseRef.current.targetX = 0;
      mouseRef.current.targetY = 0;
    };

    const parent = canvas.parentElement;
    if (parent) {
      parent.addEventListener('mousemove', handleMouseMove);
      parent.addEventListener('mouseleave', handleMouseLeave);
    }

    // --- Drawing Helpers ---

    // 1. Crystal-like 4-point star glint (quadratic curves)
    const drawFourPointStar = (ctx, cx, cy, size, alpha, r, g, b) => {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.quadraticCurveTo(cx, cy, cx + size, cy);
      ctx.quadraticCurveTo(cx, cy, cx, cy + size);
      ctx.quadraticCurveTo(cx, cy, cx - size, cy);
      ctx.quadraticCurveTo(cx, cy, cx, cy - size);
      ctx.closePath();
      ctx.fill();

      // Micro center point — a denser core of the particle's own colour, so it
      // stays visible on white (a white core would not).
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha * 1.7)})`;
      ctx.fill();
    };

    // 2. Soft diamond sparkle
    const drawDiamondSparkle = (ctx, cx, cy, size, alpha, r, g, b) => {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx + size * 0.55, cy);
      ctx.lineTo(cx, cy + size);
      ctx.lineTo(cx - size * 0.55, cy);
      ctx.closePath();
      ctx.fill();
    };

    // 3. Champagne dust / soft bokeh circle
    const drawBokeh = (ctx, cx, cy, size, alpha, r, g, b) => {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.2);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha * 0.45})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.beginPath();
      ctx.arc(cx, cy, size * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    };

    // Animation Loop
    const tick = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      ctx.clearRect(0, 0, width, height);

      // Smooth mouse coordinates interpolation
      const mouse = mouseRef.current;
      mouse.x += (mouse.targetX - mouse.x) * 0.05;
      mouse.y += (mouse.targetY - mouse.y) * 0.05;

      // Draw Particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Opacity breathing (twinkle pulse)
        p.phase += p.twinkleSpeed;
        const pulse = 0.70 + Math.sin(p.phase) * 0.30; // oscillates between 0.4 and 1.0
        p.opacity = clamp(p.baseOpacity * pulse, 0.08, 0.15);

        // Position drift
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around offscreen
        if (p.y < -10) {
          particles[i] = createParticle(p.isLarge, false);
          particles[i].y = height + 10;
          continue;
        }
        if (p.x < -10 || p.x > width + 10) {
          p.vx *= -1;
        }

        // Very slow parallax offset based on particle type/size
        const parallaxFactor = p.isLarge ? 0.06 : 0.03;
        const drawX = p.x - mouse.x * parallaxFactor;
        const drawY = p.y - mouse.y * parallaxFactor;

        if (p.type === 'four-point') {
          drawFourPointStar(ctx, drawX, drawY, p.size, p.opacity, p.color.r, p.color.g, p.color.b);
        } else if (p.type === 'diamond') {
          drawDiamondSparkle(ctx, drawX, drawY, p.size, p.opacity, p.color.r, p.color.g, p.color.b);
        } else {
          drawBokeh(ctx, drawX, drawY, p.size, p.opacity, p.color.r, p.color.g, p.color.b);
        }
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (parent) {
        parent.removeEventListener('mousemove', handleMouseMove);
        parent.removeEventListener('mouseleave', handleMouseLeave);
      }
      cancelAnimationFrame(animationFrameId);
    };
  }, [theme]);

  return (
    <canvas 
      ref={canvasRef} 
      className="absolute inset-0 w-full h-full pointer-events-none block z-10"
    />
  );
}
