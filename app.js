const form = document.querySelector("form");
const start = document.querySelector("#start");
const connection = document.querySelector("#connection");
const results = document.querySelector("#results");
const jobs = document.querySelector("#jobs");
const engineNames = {dlc: "DeepLabCut V4", sports2d: "Sports2D"};
const fileNames = {
  "overlay.mp4": "Video con puntos",
  "angles_provisional.csv": "Ángulos CSV",
  "angles_provisional.mot": "Ángulos MOT",
  "coverage.csv": "Cobertura CSV",
};
let api;
let browserDlc;

async function request(path, options) {
  const response = await fetch(api + path, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "El servicio respondió con un error.");
  }
  return response;
}

async function connect() {
  try {
    const embedded = document.querySelector("#deployment-config");
    const config = embedded ? JSON.parse(embedded.textContent) : await fetch("config.json", {
      cache: "no-store", signal: AbortSignal.timeout(10000),
    }).then(response => response.json());
    if (config.browserDlc) {
      browserDlc = config.browserDlc;
      document.querySelector("#resolution-options").hidden = false;
      const selector = document.querySelector("#engine");
      selector.replaceChildren(new Option("DeepLabCut V4", "dlc"));
      document.querySelector("#description").textContent = "Extrae coordenadas de marcha con DeepLabCut V4.";
      document.querySelector("#consent-label").textContent = "Tengo autorización para analizar este video.";
      document.querySelector("#limits").textContent = "MP4 o MOV · hasta 50 MB y 15 segundos · 5 muestras/s";
      if (!config.browserDlc.model) {
        document.querySelector("#local-model").hidden = false;
        document.querySelector("#model-file").required = true;
      }
      connection.textContent = "El video se procesa en este navegador.";
      start.disabled = false;
      return;
    }
    const address = new URL(config.apiUrl);
    if (address.protocol !== "https:" &&
        !(address.protocol === "http:" && ["localhost", "127.0.0.1"].includes(address.hostname))) {
      throw new Error("Invalid API URL");
    }
    api = address.href.replace(/\/$/, "");
    await request("/health");
    start.disabled = false;
    connection.textContent = "";
  } catch {
    connection.textContent = "El servicio de análisis no está disponible.";
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function analyze(video, engine) {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  const label = document.createElement("p");
  const progress = document.createElement("progress");
  progress.max = 1;
  progress.setAttribute("aria-label", engineNames[engine]);
  title.textContent = engineNames[engine];
  label.textContent = browserDlc ? "Abriendo video en este navegador…" : "Subiendo video…";
  card.append(title, label, progress);
  jobs.append(card);
  try {
    if (browserDlc && engine === "dlc") {
      connection.textContent = label.textContent;
      const [{analyzeDlcVideo, samplesPerSecond}, {showDlcResults}] = await Promise.all([
        import("./dlc_video.js?v=decode2"), import("./dlc_results.js?v=visual2"),
      ]);
      const modelFile = document.querySelector("#model-file").files[0];
      const resolution = Number(document.querySelector("#resolution").value);
      const result = await analyzeDlcVideo(video, browserDlc, (fraction, message) => {
        progress.value = fraction;
        label.textContent = message;
        connection.textContent = message;
      }, modelFile, resolution);
      label.textContent = `Coordenadas provisionales · ${samplesPerSecond} muestras/s · ${result.width} × ${result.height} px`;
      progress.remove();
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Descargar coordenadas CSV";
      button.addEventListener("click", () => download(result.csv, "dlc-v4-coordenadas.csv"));
      showDlcResults(card, result, samplesPerSecond);
      card.append(button);
      connection.textContent = "Análisis listo. El CSV está disponible en Resultados.";
      return;
    }
    const response = await request("/jobs/" + engine, {
      method: "POST",
      headers: {"Content-Type": "application/octet-stream", "X-Video-Name": encodeURIComponent(video.name)},
      body: video,
    });
    const {id, token} = await response.json();
    const options = {headers: {Authorization: "Bearer " + token}};
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const status = await request("/jobs/" + id, options);
      const {state, stage, progress: fraction, error, files} = await status.json();
      label.textContent = error || stage;
      progress.value = fraction;
      if (state === "review_required") {
        for (const file of files) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = fileNames[file];
          button.addEventListener("click", async () => {
            button.disabled = true;
            try {
              const output = await request("/jobs/" + id + "/" + file, options);
              download(await output.blob(), engine + "-" + file);
            } catch (failure) {
              label.textContent = failure.message;
            } finally {
              button.disabled = false;
            }
          });
          card.append(button);
        }
        break;
      }
      if (state === "failed" || state === "cancelled") break;
    }
  } catch (error) {
    label.textContent = error.message;
    if (browserDlc) connection.textContent = error.message;
    progress.remove();
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const video = document.querySelector("#video").files[0];
  if (!video || !/\.(mp4|mov)$/i.test(video.name) || video.size > 50 * 1024 ** 2) {
    connection.textContent = "Selecciona un MP4 o MOV de hasta 50 MB.";
    return;
  }
  const choice = document.querySelector("#engine").value;
  start.disabled = true;
  if (browserDlc) start.textContent = "Analizando…";
  connection.textContent = "";
  results.hidden = false;
  try {
    for (const engine of choice === "both" ? Object.keys(engineNames) : [choice]) {
      await analyze(video, engine);
    }
  } finally {
    start.disabled = false;
    start.textContent = "Analizar video";
  }
});

connect();
