export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? [];
}

export function lcsLength(a: string[], b: string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const current = [0];
    for (let j = 0; j < b.length; j++) {
      current.push(word === b[j] ? previous[j] + 1 : Math.max(previous[j + 1], current[j]));
    }
    previous = current;
  }
  return previous[b.length];
}

// 2 × LCS ÷ (words in both texts), so 0 to 1 like difflib's ratio.
export function similarity(original: string, simplified: string): number {
  const a = words(original);
  const b = words(simplified);
  if (a.length + b.length === 0) return 1;
  return (2 * lcsLength(a, b)) / (a.length + b.length);
}
