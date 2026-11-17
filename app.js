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
    const response = await fetch("config.json", {cache: "no-store"});
    const config = await response.json();
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

async function analyze(video, engine) {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  const label = document.createElement("p");
  const progress = document.createElement("progress");
  progress.max = 1;
  progress.setAttribute("aria-label", engineNames[engine]);
  title.textContent = engineNames[engine];
  label.textContent = "Subiendo video…";
  card.append(title, label, progress);
  jobs.append(card);
  try {
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
              const url = URL.createObjectURL(await output.blob());
              const link = document.createElement("a");
              link.href = url;
              link.download = engine + "-" + file;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 30000);
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
  connection.textContent = "";
  results.hidden = false;
  try {
    for (const engine of choice === "both" ? Object.keys(engineNames) : [choice]) {
      await analyze(video, engine);
    }
  } finally {
    start.disabled = false;
  }
});

connect();
