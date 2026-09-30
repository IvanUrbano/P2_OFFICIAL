/**
 * Renders NLG text that uses **bold** markdown emphasis as React nodes,
 * so nlgEngine.js's existing `**...**` markers render as actual bold text
 * instead of showing the literal asterisks.
 */
export default function renderFormattedText(text) {
  if (!text) return text;
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part);
    if (!match) return part;
    return <strong key={i}>{match[1]}</strong>;
  });
}
