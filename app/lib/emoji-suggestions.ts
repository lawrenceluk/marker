export const DEFAULT_EMOJI = ["👍", "❤️", "👀"];

// A compact reaction vocabulary for Jev. The full picker remains searchable.
export const REACTION_EMOJI = [
  "👍", "❤️", "👀", "😂", "🎉", "🙏", "🔥", "💯", "🤔", "😮", "😢", "👏",
  "✅", "🚀", "💡", "🙌", "😍", "😅", "😬", "👎", "🤯", "💪", "🍿", "🫶",
];

export function emojiQuestion() {
  return {
    type: "choice",
    instructions: "Which emoji would a reader most naturally use as a short response to the selected quote in its nearby passage? Consider agreement, emotion, humor, and the actual subject. Score all options; avoid treating the first option as a default.",
    criteria: Object.fromEntries(REACTION_EMOJI.map((emoji, index) => [`emoji_${index + 1}`, { emoji }])),
  };
}

export function emojiFromAnswer(answer: unknown): string[] | null {
  if (!answer || typeof answer !== "object") return null;
  const data = answer as { type?: string; probabilities?: Record<string, unknown> };
  if (data.type !== "choice" || !data.probabilities) return null;
  const scored = REACTION_EMOJI.map((emoji, index) => ({ emoji, score: data.probabilities?.[`emoji_${index + 1}`] }));
  if (scored.some(item => typeof item.score !== "number" || !Number.isFinite(item.score))) return null;
  scored.sort((a, b) => (b.score as number) - (a.score as number));
  if ((scored[0].score as number) < 0.12) return null;
  return scored.slice(0, 3).map(item => item.emoji);
}
