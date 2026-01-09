function formatNumber(value) {
  return Math.round(value).toString();
}

export function createHUD() {
  const hudEl = document.getElementById("hud");
  const speedEl = document.getElementById("hud-speed");
  const altitudeEl = document.getElementById("hud-altitude");
  const throttleEl = document.getElementById("hud-throttle");
  const statusEl = document.getElementById("hud-status");
  const cockpitCanvas = document.getElementById("cockpitHud");
  const cockpitCtx = cockpitCanvas.getContext("2d");
  const minimap = document.getElementById("minimap");
  const mapCtx = minimap.getContext("2d");
  const mapSize = minimap.width;
  const worldExtent = 1000;
  let cockpitMode = false;

  function update({ speed, altitude, throttle, position, islands, isPaused, brakeEngaged }) {
    speedEl.textContent = `Speed: ${formatNumber(speed)} m/s`;
    altitudeEl.textContent = `Altitude: ${formatNumber(altitude)} m`;
    throttleEl.textContent = `Throttle: ${formatNumber(throttle * 100)}%`;

    const statusParts = [];
    if (isPaused) {
      statusParts.push("PAUSED");
    }
    if (brakeEngaged) {
      statusParts.push("BRAKE ON");
    }
    statusEl.textContent = statusParts.join(" | ");

    if (cockpitMode) {
      drawCockpitHUD({
        speed,
        altitude,
        throttle,
        isPaused,
        brakeEngaged,
      });
    } else {
      cockpitCtx.clearRect(0, 0, cockpitCanvas.width, cockpitCanvas.height);
    }

    mapCtx.clearRect(0, 0, mapSize, mapSize);
    mapCtx.fillStyle = "#2b5fa6";
    mapCtx.fillRect(0, 0, mapSize, mapSize);

    mapCtx.fillStyle = "#38a049";
    islands.forEach((island) => {
      const islandX = ((island.x / (worldExtent * 2)) + 0.5) * mapSize;
      const islandY = ((island.z / (worldExtent * 2)) + 0.5) * mapSize;
      const islandPixelSize = (island.size / (worldExtent * 2)) * mapSize;
      mapCtx.fillRect(
        islandX - islandPixelSize / 2,
        islandY - islandPixelSize / 2,
        islandPixelSize,
        islandPixelSize
      );
    });

    const clampedX = Math.max(-worldExtent, Math.min(worldExtent, position.x));
    const clampedZ = Math.max(-worldExtent, Math.min(worldExtent, position.z));
    const mapX = ((clampedX / (worldExtent * 2)) + 0.5) * mapSize;
    const mapY = ((clampedZ / (worldExtent * 2)) + 0.5) * mapSize;

    mapCtx.fillStyle = "#d94a3a";
    mapCtx.beginPath();
    mapCtx.arc(mapX, mapY, 5, 0, Math.PI * 2);
    mapCtx.fill();
  }

  function setMode(mode) {
    cockpitMode = mode === "cockpit";
    cockpitCanvas.style.display = cockpitMode ? "block" : "none";
    if (mode === "cockpit") {
      hudEl.classList.add("cockpit");
    } else {
      hudEl.classList.remove("cockpit");
    }
  }

  function drawCockpitHUD({ speed, altitude, throttle, isPaused, brakeEngaged }) {
    const canvas = cockpitCanvas;
    const ctx = cockpitCtx;
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    const glowColor = "#b6ff4a";
    ctx.strokeStyle = glowColor;
    ctx.fillStyle = glowColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(182, 255, 74, 0.4)";
    ctx.shadowBlur = 6;

    ctx.beginPath();
    const frameInsetX = Math.max(80, width * 0.08);
    const frameInsetY = Math.max(40, height * 0.06);
    const frameRadius = Math.min(90, width * 0.08);
    drawRoundedRect(
      ctx,
      frameInsetX,
      frameInsetY,
      width - frameInsetX * 2,
      height - frameInsetY * 2,
      frameRadius
    );
    ctx.stroke();

    const topLineY = frameInsetY + 70;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 140, topLineY);
    ctx.lineTo(width / 2 + 140, topLineY);
    ctx.stroke();

    for (let i = -3; i <= 3; i += 1) {
      const x = width / 2 + i * 40;
      const y = topLineY;
      const tick = i === 0 ? 16 : 8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - tick);
      ctx.stroke();
    }

    const tapeHeight = Math.min(360, height * 0.55);
    const tapeWidth = Math.min(140, width * 0.12);
    const tapeTop = frameInsetY + 120;
    drawTape({
      ctx,
      x: frameInsetX + 30,
      y: tapeTop,
      width: tapeWidth,
      height: tapeHeight,
      value: speed,
      label: "SPD",
      unit: "m/s",
    });

    drawTape({
      ctx,
      x: width - frameInsetX - tapeWidth - 30,
      y: tapeTop,
      width: tapeWidth,
      height: tapeHeight,
      value: altitude,
      label: "ALT",
      unit: "m",
    });

    const centerY = height * 0.55;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 60, centerY);
    ctx.lineTo(width / 2 - 10, centerY);
    ctx.moveTo(width / 2 + 10, centerY);
    ctx.lineTo(width / 2 + 60, centerY);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(width / 2, centerY, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(width / 2 - 120, centerY + 40);
    ctx.lineTo(width / 2 - 40, centerY + 40);
    ctx.moveTo(width / 2 + 40, centerY + 40);
    ctx.lineTo(width / 2 + 120, centerY + 40);
    ctx.stroke();

    ctx.font = "18px 'Trebuchet MS', sans-serif";
    ctx.fillText(
      `THR ${Math.round(throttle * 100)}%`,
      width / 2 - 40,
      height - frameInsetY - 20
    );

    if (isPaused || brakeEngaged) {
      ctx.font = "20px 'Trebuchet MS', sans-serif";
      let statusText = "";
      if (isPaused) {
        statusText += "PAUSED";
      }
      if (brakeEngaged) {
        statusText += statusText ? " | BRAKE ON" : "BRAKE ON";
      }
      ctx.fillText(
        statusText,
        width / 2 - ctx.measureText(statusText).width / 2,
        frameInsetY + 40
      );
    }

    ctx.restore();
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, radius);
      return;
    }

    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawTape({ ctx, x, y, width, height, value, label, unit }) {
    ctx.save();
    const tickCount = 7;
    const mid = y + height / 2;
    const range = 60;
    const step = range / (tickCount - 1);

    ctx.strokeRect(x, y, width, height);
    ctx.font = "16px 'Trebuchet MS', sans-serif";
    ctx.fillText(label, x + 10, y - 12);

    for (let i = 0; i < tickCount; i += 1) {
      const offset = (i - (tickCount - 1) / 2) * step;
      const tickValue = Math.round(value + offset);
      const ty = mid - (offset / range) * (height / 2 - 20);
      ctx.beginPath();
      ctx.moveTo(x + 6, ty);
      ctx.lineTo(x + 24, ty);
      ctx.stroke();
      ctx.fillText(`${tickValue}`, x + 30, ty + 5);
    }

    ctx.fillRect(x + width - 6, mid - 18, 6, 36);
    ctx.fillStyle = "#0c1a0c";
    ctx.fillRect(x + width - 60, mid - 18, 54, 36);
    ctx.fillStyle = "#b6ff4a";
    ctx.fillText(`${Math.round(value)}`, x + width - 52, mid + 6);
    ctx.font = "12px 'Trebuchet MS', sans-serif";
    ctx.fillText(unit, x + width - 52, mid + 22);
    ctx.restore();
  }

  return { update, setMode };
}
