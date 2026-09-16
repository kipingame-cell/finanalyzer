// Кастомные canvas-графики без библиотек: пончик и столбцы, с анимацией.

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: rect.height };
}

function animate(draw, duration = 600) {
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
    draw(e);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// data: [{label, value, color}]
export function drawDonut(canvas, data, centerText = '') {
  const { ctx, w, h } = setupCanvas(canvas);
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 8;
  const r = R * 0.62;

  animate((e) => {
    ctx.clearRect(0, 0, w, h);
    if (!total) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(148,163,184,0.15)';
      ctx.fill();
    } else {
      let angle = -Math.PI / 2;
      for (const d of data) {
        const sweep = (d.value / total) * Math.PI * 2 * e;
        if (sweep <= 0) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, R, angle, angle + sweep);
        ctx.arc(cx, cy, r, angle + sweep, angle, true);
        ctx.closePath();
        ctx.fillStyle = d.color;
        ctx.fill();
        angle += sweep;
      }
    }
    if (centerText) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = centerText.split('\n');
      lines.forEach((ln, i) => ctx.fillText(ln, cx, cy + (i - (lines.length - 1) / 2) * 18));
    }
  });
}

// months: [{label, income, expense}]
export function drawBars(canvas, months) {
  const { ctx, w, h } = setupCanvas(canvas);
  const padL = 8, padR = 8, padT = 14, padB = 22;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const maxV = Math.max(1, ...months.map(m => Math.max(m.income, m.expense)));

  animate((e) => {
    ctx.clearRect(0, 0, w, h);
    const groupW = plotW / months.length;
    months.forEach((m, i) => {
      const gx = padL + i * groupW;
      const bw = Math.min(14, groupW * 0.22);
      const gap = 4;
      const x1 = gx + groupW / 2 - bw - gap / 2;
      const x2 = gx + groupW / 2 + gap / 2;
      const hInc = (m.income / maxV) * plotH * e;
      const hExp = (m.expense / maxV) * plotH * e;
      roundBar(ctx, x1, padT + plotH - hInc, bw, hInc, '#22c55e');
      roundBar(ctx, x2, padT + plotH - hExp, bw, hExp, '#f43f5e');
      ctx.fillStyle = 'rgba(226,232,240,0.6)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.label, gx + groupW / 2, h - 8);
    });
  });
}

function roundBar(ctx, x, y, w, h, color) {
  if (h <= 0) return;
  const r = Math.min(4, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
