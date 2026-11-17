import { bodyparts } from "./dlc_pose.js";

const links = [
  ["VertebraC7", "Hombro"], ["Hombro", "Codo"], ["Codo", "Muneca"],
  ["Hombro", "Cadera"], ["EIPS", "Cadera"], ["Cadera", "Rodilla"],
  ["Rodilla", "Tobillo"], ["Tobillo", "Pie"],
];
const usable = point => point && point.likelihood >= 0.5 &&
  Number.isFinite(point.x) && Number.isFinite(point.y);

function element(tag, content) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  return node;
}

function drawChart(canvas, samples, joint) {
  const ctx = canvas.getContext("2d");
  const {width, height} = canvas;
  const points = samples.map(sample => sample.points[joint]);
  const values = points.filter(usable).flatMap(point => [point.x, point.y]);
  const low = Math.floor(Math.min(...values, 0) / 100) * 100;
  const high = Math.max(low + 100, Math.ceil(Math.max(...values, 0) / 100) * 100);
  const left = 57, right = width - 24, top = 24, bottom = height - 45;
  const duration = samples.at(-1).timestamp || 0.2;
  const x = time => left + time / duration * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "17px system-ui";
  for (let tick = 0; tick <= 4; tick++) {
    const value = low + (high - low) * tick / 4;
    ctx.strokeStyle = "#cbdad1";
    ctx.beginPath();
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.stroke();
    ctx.fillStyle = "#425b51";
    ctx.fillText(Math.round(value), 4, y(value) + 5);
    ctx.fillText((duration * tick / 4).toFixed(1), x(duration * tick / 4) - 12, bottom + 23);
  }
  ctx.fillText("Tiempo (s)", width / 2 - 38, height - 2);
  ctx.fillText("px", 8, 18);
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
      if (!usable(point)) continue;
      ctx.beginPath();
      ctx.arc(x(samples[index].timestamp), y(point[axis]), 3, 0, Math.PI * 2);
      ctx.fill();
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
  for (const [index, name] of bodyparts.entries()) select.add(new Option(name, index));
  select.value = String(bodyparts.indexOf("Rodilla"));
  const note = element("p");
  const draw = () => {
    chart.setAttribute("aria-label", `Coordenadas X e Y de ${bodyparts[select.value]} en píxeles`);
    const hasPoints = drawChart(chart, result.samples, Number(select.value));
    note.textContent = hasPoints ? "X horizontal (verde) · Y vertical (naranja)"
      : "Sin coordenadas con confianza de al menos 0,50 para este punto.";
  };
  select.addEventListener("change", draw);
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
    const sample = result.samples[Math.min(result.samples.length - 1, Math.floor(video.currentTime * rate))];
    const points = Object.fromEntries(sample.points.map(point => [point.name, point]));
    const radius = Math.max(4, overlay.width * 0.004);
    ctx.strokeStyle = "#70ffd0";
    ctx.fillStyle = "#ffe16b";
    ctx.lineWidth = Math.max(2, radius / 2);
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
      ctx.strokeStyle = "#142b25";
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
    element("h4", "Gráficas de coordenadas"), select, chart, note);
  card.append(section);
}
