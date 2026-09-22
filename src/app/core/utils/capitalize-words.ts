export function capitalizeWords(value: string): string {
  return value.replace(/\p{L}+/gu, (word) => word[0].toLocaleUpperCase() + word.slice(1));
}
