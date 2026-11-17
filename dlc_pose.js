export const bodyparts = [
  "Cadera", "Muneca", "Pie", "Hombro", "VertebraC7",
  "Codo", "Rodilla", "EIPS", "Tobillo",
];

export function normalizePixels(rgba, width, height) {
  const pixels = width * height;
  if (rgba.length !== pixels * 4) throw new Error("Dimensiones de imagen incompatibles.");
  const rgb = new Float32Array(pixels * 3);
  const means = [0.485, 0.456, 0.406];
  const deviations = [0.229, 0.224, 0.225];
  for (let channel = 0; channel < 3; channel++) {
    for (let pixel = 0; pixel < pixels; pixel++) {
      rgb[channel * pixels + pixel] =
        (rgba[pixel * 4 + channel] / 255 - means[channel]) / deviations[channel];
    }
  }
  return rgb;
}

export function decodeBodyparts(heatmap, locref, stride, locrefStd) {
  const [batch, joints, height, width] = heatmap.dims;
  const cells = height * width;
  if (batch !== 1 || joints !== bodyparts.length ||
      heatmap.data.length !== joints * cells ||
      locref.dims.join(",") !== [1, 2 * joints, height, width].join(",")) {
    throw new Error("La salida ONNX de DeepLabCut V4 tiene dimensiones incompatibles.");
  }
  return bodyparts.map((name, joint) => {
    const start = joint * cells;
    let cell = 0;
    for (let index = 1; index < cells; index++) {
      if (heatmap.data[start + index] > heatmap.data[start + cell]) cell = index;
    }
    const dx = locref.data[2 * joint * cells + cell] * locrefStd;
    const dy = locref.data[(2 * joint + 1) * cells + cell] * locrefStd;
    return {
      name,
      x: (cell % width + 0.5) * stride + dx,
      y: (Math.floor(cell / width) + 0.5) * stride + dy,
      likelihood: Math.min(1, Math.max(0, heatmap.data[start + cell])),
    };
  });
}
