import { bodyparts, decodeBodyparts, normalizePixels } from "./dlc_pose.js";

export const samplesPerSecond = 5;

function waitForVideo(video, event, action, stage) {
  return new Promise((resolve, reject) => {
    const remove = () => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
    };
    const ready = () => {
      remove();
      resolve();
    };
    const failed = () => {
      remove();
      const code = video.error?.code;
      reject(new Error(`${stage}${code ? ` (error de video ${code})` : " (tiempo de espera agotado)"}.`));
    };
    const timer = setTimeout(failed, 30000);
    video.addEventListener(event, ready, {once: true});
    video.addEventListener("error", failed, {once: true});
    action();
  });
}

export async function analyzeDlcVideo(file, config, onProgress, modelFile, maxDimension) {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("aria-hidden", "true");
  video.style.cssText = "position:fixed;left:-16px;top:0;width:1px;height:1px;pointer-events:none";
  document.body.append(video);
  let source = URL.createObjectURL(file);
  let playback = file;
  let session;
  const open = stage => waitForVideo(video, "loadeddata", () => {
    video.src = source;
    video.load();
  }, stage);
  const convert = async () => {
    onProgress(0, "Preparando un formato compatible en este navegador…");
    const {convertVideoForBrowser} = await import("./video_compat.js?v=compat2");
    const compatible = await convertVideoForBrowser(file, message => onProgress(0, message));
    URL.revokeObjectURL(source);
    playback = compatible;
    source = URL.createObjectURL(compatible);
    await open("El navegador no pudo abrir el video después de la conversión local");
  };
  try {
    try {
      await open("El navegador no pudo abrir el archivo original");
    } catch {
      await convert();
    }
    if (!video.videoWidth || !video.videoHeight || !(video.duration > 0 && video.duration <= 15)) {
      throw new Error("El video debe durar hasta 15 segundos y tener dimensiones válidas.");
    }
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter || adapter.info.isFallbackAdapter) {
      throw new Error("Este equipo necesita un navegador con WebGPU y aceleración gráfica.");
    }
    onProgress(0, "Cargando DeepLabCut V4…");
    const ort = await import(new URL(config.runtime, document.baseURI).href);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = new URL(config.wasm, document.baseURI).href;
    ort.env.webgpu.adapter = adapter;
    let model;
    if (config.model) {
      model = new URL(config.model, document.baseURI).href;
    } else {
      if (modelFile?.size !== 96165128) throw new Error("Selecciona el ONNX exportado de DeepLabCut V4.");
      const bytes = await modelFile.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        byte => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== "076e4a18effe9c2bb651a7a8d952dcbffe469c257c9e56fd3f930373d11dc453") {
        throw new Error("El archivo seleccionado no coincide con el modelo DeepLabCut V4 verificado.");
      }
      model = new Uint8Array(bytes);
    }
    session = await ort.InferenceSession.create(model, {executionProviders: ["webgpu"]});

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", {willReadFrequently: true});
    const count = Math.ceil(video.duration * samplesPerSecond);
    const rows = [["sample", "requested_time_s", ...bodyparts.flatMap(
      name => [name + "_x", name + "_y", name + "_likelihood"])]];
    const samples = [];
    for (let sample = 0; sample < count; sample++) {
      const timestamp = sample / samplesPerSecond;
      const seek = () => Math.abs(video.currentTime - timestamp) < 0.001 && video.readyState >= 2
        ? Promise.resolve() : waitForVideo(video, "seeked", () => { video.currentTime = timestamp; },
          `El navegador no pudo leer el fotograma en ${timestamp.toFixed(1)} s`);
      try {
        await seek();
      } catch {
        if (playback === file) await convert();
        else await open("El navegador no pudo volver a abrir el video convertido");
        await seek();
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const rgb = normalizePixels(pixels.data, canvas.width, canvas.height);
      const outputs = await session.run({rgb: new ort.Tensor(
        "float32", rgb, [1, 3, canvas.height, canvas.width])});
      const points = decodeBodyparts(outputs.heatmap, outputs.locref, 8, 7.2801);
      const scaled = points.map(point => ({...point, x: point.x * video.videoWidth / canvas.width,
        y: point.y * video.videoHeight / canvas.height}));
      samples.push({timestamp, points: scaled});
      rows.push([sample, timestamp, ...scaled.flatMap(({x, y, likelihood}) => [x, y, likelihood])]);
      onProgress((sample + 1) / count, `Muestras procesadas: ${sample + 1} de ${count} · ${canvas.width} × ${canvas.height} px`);
    }
    const csv = new Blob([rows.map(row => row.join(",")).join("\n") + "\n"], {type: "text/csv"});
    return {csv, samples, playback, width: canvas.width, height: canvas.height};
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(source);
    await session?.release();
  }
}
