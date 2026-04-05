/**
 * Утилиты для пазла.
 * tiles[position] = originalIndex (какой кусок картинки стоит на этой позиции).
 * Победа: tiles[i] === i для всех i.
 * Механика обмена (tap-to-swap) — любая перестановка достижима.
 */

/** Fisher-Yates shuffle. Гарантирует, что результат не является уже решённым. */
export function shuffleTiles(gridSize) {
  const n = gridSize * gridSize;
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (arr.every((v, i) => v === i)) {
    [arr[0], arr[1]] = [arr[1], arr[0]];
  }
  return arr;
}

export function isSolved(tiles) {
  return tiles.every((v, i) => v === i);
}

export function countCorrect(tiles) {
  return tiles.filter((v, i) => v === i).length;
}
