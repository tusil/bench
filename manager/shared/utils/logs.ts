export const maxLogLines = 5_000;
export const maxLogCharacters = 2 * 1024 * 1024;

export function appendLogText(
  current: string,
  incoming: string,
  lineLimit = maxLogLines,
  characterLimit = maxLogCharacters,
): string {
  let value = current + incoming;
  if (value.length > characterLimit) {
    value = value.slice(value.length - characterLimit);
  }

  const lines = value.split("\n");
  return lines.length > lineLimit ? lines.slice(-lineLimit).join("\n") : value;
}
