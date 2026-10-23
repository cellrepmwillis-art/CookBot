import Anthropic from "./vendor/anthropic-sdk-0.131.0.js";

const MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "notes"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "portion", "calories"],
        properties: {
          name: { type: "string" },
          portion: { type: "string" },
          calories: { type: "integer" },
        },
      },
    },
    notes: { type: "string" },
  },
};

const SYSTEM = `You estimate the calories in photos of food and drinks.
List every distinct food and drink you can see as a separate item, with a short name, the portion you assume (e.g. "1 cup", "about 250 g", "16 oz glass"), and your best single calorie estimate for that portion as an integer.
Judge portion size from visual cues such as plate size, utensils and hands. Account for visible oils, sauces, dressings, and toppings. For drinks, infer the likely contents (e.g. a cola can is regular unless it looks diet).
If the person adds a note, trust it over what you infer from the photo.
If the photo contains no food or drink, return an empty items list and say so in notes.
Use notes for one or two short sentences on your main assumptions or uncertainty.`;

export class EstimateError extends Error {}

// image: { mediaType, base64 }. Returns { items: [{name, portion, calories}], notes }.
export async function estimateCalories({ apiKey, image, note }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const content = [
    { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
    { type: "text", text: note ? `Note from me: ${note}` : "Estimate the calories in this photo." },
  ];

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new EstimateError("Your API key was rejected. Check it in Settings.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new EstimateError("Too many requests right now. Wait a moment and try again.");
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new EstimateError("Couldn't reach the estimator. Check your internet connection.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new EstimateError(`The estimator returned an error (${err.status ?? "unknown"}): ${err.message}`);
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new EstimateError("The estimator declined to analyze this photo. Try another photo or enter it manually.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new EstimateError("The estimate was cut off. Please try again.");
  }

  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new EstimateError("The estimator returned no result. Please try again.");
  const result = JSON.parse(text);
  result.items = result.items.map((item) => ({ ...item, calories: Math.max(0, Math.round(item.calories)) }));
  return result;
}
