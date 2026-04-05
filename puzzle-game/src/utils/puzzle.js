/**
 * Puzzle utilities: shuffle and solve-check.
 *
 * tiles[i] = originalIndex
 *   → position i on the board shows the image piece from originalIndex.
 *
 * Win condition: tiles[i] === i for all i.
 *
 * Because we use tap-to-swap mechanics (not a sliding puzzle), any
 * permutation is reachable from any other permutation — no solvability
 * check needed.
 */

/**
 * Fisher-Yates shuffle. Returns array of length gridSize²
 * where tiles[position] = originalPieceIndex.
 */
export function shuffleTiles(gridSize) {
  const n = gridSize * gridSize;
  const arr = Array.from({ length: n }, (_, i) => i);

  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  // Guarantee the result is not trivially solved (probability ≈ 1/n!)
  if (arr.every((v, i) => v === i)) {
    [arr[0], arr[1]] = [arr[1], arr[0]];
  }

  return arr;
}

/**
 * Returns true when the puzzle is in the solved state.
 */
export function isSolved(tiles) {
  return tiles.every((v, i) => v === i);
}

/**
 * Counts how many tiles are currently in the correct position.
 */
export function countCorrect(tiles) {
  return tiles.filter((v, i) => v === i).length;
}
