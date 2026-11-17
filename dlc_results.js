import { bodyparts } from "./dlc_pose.js";

const links = [
  ["VertebraC7", "Hombro"], ["Hombro", "Codo"], ["Codo", "Muneca"],
  ["Hombro", "Cadera"], ["EIPS", "Cadera"], ["Cadera", "Rodilla"],
  ["Rodilla", "Tobillo"], ["Tobillo", "Pie"],
];
const usable = point => point && point.likelihood >= 0.5 &&
  Number.isFinite(point.x) && Number.isFinite(point.y);
const finite = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);

function element(tag, content) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  return node;
}

function drawChart(canvas, samples, joint, showWeak) {
  const ctx = canvas.getContext("2d");
  const {width, height} = canvas;
  const points = samples.map(sample => sample.points[joint]);
  const values = points.filter(showWeak ? finite : usable).flatMap(point => [point.x, point.y]);
  if (!values.length) return false;
  const low = Math.floor(Math.min(...values) / 50) * 50;
  const high = Math.max(low + 50, Math.ceil(Math.max(...values) / 50) * 50);
  const left = 68, right = width - 32, top = 34, bottom = height - 54;
  const duration = samples.at(-1).timestamp || 0.2;
  const x = time => left + time / duration * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "15px system-ui";
  for (let tick = 0; tick <= 4; tick++) {
    const value = low + (high - low) * tick / 4;
    ctx.strokeStyle = "#cbdad1";
    ctx.beginPath();
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.stroke();
    ctx.fillStyle = "#425b51";
    ctx.fillText(Math.round(value), 13, y(value) + 5);
    ctx.fillText((duration * tick / 4).toFixed(1), x(duration * tick / 4) - 12, bottom + 23);
  }
  ctx.fillText("Tiempo (s)", width / 2 - 38, height - 2);
  ctx.fillText("Píxeles", 13, 17);
  for (const [axis, color] of [["x", "#17664f"], ["y", "#a84905"]]) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    let connected = false;
    for (const [index, point] of points.entries()) {
      if (!usable(point)) {
        connected = false;
        continue;
      }
      const position = [x(samples[index].timestamp), y(point[axis])];
      if (connected) ctx.lineTo(...position);
      else ctx.moveTo(...position);
      connected = true;
    }
    ctx.stroke();
    for (const [index, point] of points.entries()) {
      const reliable = usable(point);
      if (!reliable && !(showWeak && finite(point))) continue;
      ctx.beginPath();
      ctx.arc(x(samples[index].timestamp), y(point[axis]), reliable ? 3 : 3.5, 0, Math.PI * 2);
      if (reliable) ctx.fill();
      else {
        ctx.globalAlpha = 0.55;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  return values.length > 0;
}

export function showDlcResults(card, result, rate) {
  const section = element("section");
  section.className = "dlc-visuals";
  const chart = element("canvas");
  chart.width = 720;
  chart.height = 280;
  chart.setAttribute("role", "img");
  const select = element("select");
  select.setAttribute("aria-label", "Punto anatómico");
  const counts = bodyparts.map((_, index) => result.samples.filter(sample => usable(sample.points[index])).length);
  for (const [index, name] of bodyparts.entries()) {
    select.add(new Option(`${name} · ${counts[index]}/${result.samples.length} sobre el umbral`, index));
  }
  select.value = String(counts.indexOf(Math.max(...counts)));
  const weakToggle = element("input");
  weakToggle.type = "checkbox";
  const weakLabel = element("label");
  weakLabel.className = "dlc-toggle";
  weakLabel.append(weakToggle, " Mostrar muestras de baja confianza");
  const note = element("p");
  const draw = () => {
    chart.setAttribute("aria-label", `Coordenadas X e Y de ${bodyparts[select.value]} en píxeles`);
    chart.hidden = !drawChart(chart, result.samples, Number(select.value), weakToggle.checked);
    const count = counts[Number(select.value)];
    note.textContent = chart.hidden ? "Este punto no alcanzó 0,50 de confianza en ninguna muestra."
      : `${count} de ${result.samples.length} muestras con confianza ≥ 0,50.`;
    legend.hidden = chart.hidden;
  };
  const legend = element("div");
  legend.className = "dlc-legend";
  for (const [text, className] of [["X horizontal", "axis-x"], ["Y vertical", "axis-y"]]) {
    const item = element("span", text);
    item.className = className;
    legend.append(item);
  }
  legend.append(element("span", "○ Baja confianza"));
  select.addEventListener("change", draw);
  weakToggle.addEventListener("change", draw);
  draw();

  const player = element("div");
  player.className = "dlc-player";
  const video = element("video");
  video.controls = true;
  video.playsInline = true;
  const overlay = element("canvas");
  overlay.setAttribute("aria-hidden", "true");
  player.append(video, overlay);
  const paint = () => {
    if (!video.videoWidth) return;
    if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const sample = result.samples[Math.min(result.samples.length - 1, Math.round(video.currentTime * rate))];
    const points = Object.fromEntries(sample.points.map(point => [point.name, point]));
    const radius = Math.max(4, overlay.width * 0.0027);
    ctx.strokeStyle = "#55ebde";
    ctx.fillStyle = "#e8fffb";
    ctx.lineWidth = Math.max(2, radius * 0.6);
    ctx.lineCap = "round";
    for (const [from, to] of links) {
      if (!usable(points[from]) || !usable(points[to])) continue;
      ctx.beginPath();
      ctx.moveTo(points[from].x, points[from].y);
      ctx.lineTo(points[to].x, points[to].y);
      ctx.stroke();
    }
    for (const point of sample.points.filter(usable)) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#12655f";
      ctx.stroke();
    }
  };
  const update = () => {
    paint();
    if (!video.paused && !video.ended) requestAnimationFrame(update);
  };
  video.addEventListener("loadeddata", paint);
  video.addEventListener("seeked", paint);
  video.addEventListener("play", update);
  video.src = URL.createObjectURL(result.playback);

  section.append(element("h4", "Video con puntos de seguimiento"), player,
    element("p", `Puntos actualizados ${rate} veces por segundo · confianza mínima 0,50`),
    element("h4", "Gráficas de coordenadas"), select, note, weakLabel, legend, chart);
  card.append(section);
}
