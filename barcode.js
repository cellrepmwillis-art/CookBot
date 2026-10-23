// Barcode scanning and lookup. Uses the browser's built-in BarcodeDetector
// where it exists (Android Chrome) and the bundled ZXing reader elsewhere
// (iPhone Safari). Lookups are offline against branded.json; looking a code
// up on Open Food Facts happens only when the user asks.

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

// UPC-E (8 digits, on small packages) written out as the 12-digit UPC-A.
function expandUpcE(code) {
  const [n, d0, d1, d2, d3, d4, last, check] = code;
  const middle = {
    0: `${d0}${d1}${last}0000${d2}${d3}${d4}`,
    1: `${d0}${d1}${last}0000${d2}${d3}${d4}`,
    2: `${d0}${d1}${last}0000${d2}${d3}${d4}`,
    3: `${d0}${d1}${d2}00000${d3}${d4}`,
    4: `${d0}${d1}${d2}${d3}00000${d4}`,
  }[last] ?? `${d0}${d1}${d2}${d3}${d4}0000${last}`;
  return `${n}${middle}${check}`;
}

// Ways a scanned code may be stored: without leading zeros, so UPC-A and
// EAN-13 match, and for 8-digit codes also the UPC-E expansion.
export function barcodeKeys(raw) {
  const digits = String(raw).replace(/\D/g, "");
  const keys = [digits.replace(/^0+/, "")];
  if (digits.length === 8 && (digits[0] === "0" || digits[0] === "1")) keys.push(expandUpcE(digits).replace(/^0+/, ""));
  return keys.filter(Boolean);
}

// ---- Reading codes from the camera or a photo ----

let zxing = null;
async function zxingReader() {
  if (!zxing) {
    const lib = await import("./vendor/zxing-0.23.0.js");
    const hints = new Map([
      [lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.EAN_13, lib.BarcodeFormat.EAN_8, lib.BarcodeFormat.UPC_A, lib.BarcodeFormat.UPC_E]],
      [lib.DecodeHintType.TRY_HARDER, true],
    ]);
    zxing = { lib, hints, reader: new lib.MultiFormatOneDReader(hints) };
  }
  return zxing;
}

async function nativeDetector() {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

// Reads a barcode from a canvas with ZXing, or returns null.
async function decodeCanvas(canvas) {
  const { lib, hints, reader } = await zxingReader();
  const { width, height } = canvas;
  const { data } = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height);
  const luminance = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < luminance.length; i++, p += 4) {
    luminance[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  try {
    const bitmap = new lib.BinaryBitmap(new lib.HybridBinarizer(new lib.RGBLuminanceSource(luminance, width, height)));
    return reader.decode(bitmap, hints).getText();
  } catch {
    return null; // no barcode in this frame
  } finally {
    reader.reset();
  }
}

// Starts the camera in `video` and calls onCode once with the first barcode
// seen. Returns a function that stops scanning. Throws if there's no camera
// or permission is denied.
export async function startScanner(video, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  await video.play();

  const detector = await nativeDetector();
  const canvas = document.createElement("canvas");
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  const tick = async () => {
    if (stopped) return;
    let code = null;
    if (video.readyState >= 2 && video.videoWidth) {
      if (detector) {
        const found = await detector.detect(video).catch(() => []);
        code = found[0]?.rawValue ?? null;
      } else {
        // The middle band of the frame, where the guide box is, at most 960 px wide.
        const scale = Math.min(1, 960 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale * 0.5);
        canvas.getContext("2d", { willReadFrequently: true }).drawImage(
          video, 0, video.videoHeight * 0.25, video.videoWidth, video.videoHeight * 0.5, 0, 0, canvas.width, canvas.height,
        );
        code = await decodeCanvas(canvas);
      }
    }
    if (stopped) return;
    if (code) {
      stop();
      onCode(code);
    } else {
      setTimeout(tick, 120);
    }
  };
  tick();
  return stop;
}

// Reads a barcode from a photo file, or returns null.
export async function decodePhoto(file) {
  const bitmap = await createImageBitmap(file);
  const detector = await nativeDetector();
  if (detector) {
    const found = await detector.detect(bitmap).catch(() => []);
    if (found[0]) return found[0].rawValue;
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return decodeCanvas(canvas);
}

// ---- Optional online lookup ----

// Asks Open Food Facts about a barcode. Returns a food in the app's format
// ([name, kcal per 100 g, portions, 0, barcode]) or null if it isn't known.
export async function lookupOnline(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const { status, product } = await response.json();
  if (status !== 1 || !product) return null;
  const n = product.nutriments ?? {};
  const kcal = n["energy-kcal_100g"] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : null);
  const name = (product.product_name || "").trim();
  if (kcal == null || !name) return null;
  const brand = (product.brands || "").split(",")[0].trim();
  const display = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;
  const grams = Number(product.serving_quantity);
  const portions = grams > 0 ? [[product.serving_size || `1 serving (${grams} g)`, grams]] : [];
  return [display, Math.round(kcal), portions, 0, barcodeKeys(code)[0]];
}
