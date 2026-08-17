// Ukrainian pluralization (one/few/many), e.g. 1 об'єкт / 2 об'єкти / 5 об'єктів.
export function pluralizeUk(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function pluralizeObjects(n: number): string {
  return pluralizeUk(n, "об'єкт", "об'єкти", "об'єктів")
}
