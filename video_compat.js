const wrapper = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/";
const core = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/";

export async function convertVideoForBrowser(file, report) {
  const {FFmpeg} = await import(wrapper + "index.js");
  const converter = new FFmpeg();
  const worker = URL.createObjectURL(new Blob([`import "${wrapper}worker.js";`],
    {type: "text/javascript"}));
  const timeout = setTimeout(() => converter.terminate(), 120000);
  try {
    await converter.load({classWorkerURL: worker, coreURL: core + "ffmpeg-core.js",
      wasmURL: core + "ffmpeg-core.wasm"});
    await converter.writeFile("input", new Uint8Array(await file.arrayBuffer()));
    let displayed = -1;
    converter.on("progress", ({time}) => {
      const seconds = Math.floor(time / 1000000);
      if (seconds > displayed) {
        displayed = seconds;
        report(`Convirtiendo en este equipo · ${seconds} s de video preparados`);
      }
    });
    const status = await converter.exec(["-i", "input", "-map", "0:v:0", "-an", "-sn", "-t", "16",
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libvpx", "-deadline", "realtime",
      "-cpu-used", "8", "-crf", "10", "-b:v", "0", "-pix_fmt", "yuv420p", "-threads", "1", "output.webm"]);
    if (status !== 0) throw new Error("No se pudo convertir el MP4 en este navegador.");
    return new Blob([await converter.readFile("output.webm")], {type: "video/webm"});
  } finally {
    clearTimeout(timeout);
    converter.terminate();
    URL.revokeObjectURL(worker);
  }
}
