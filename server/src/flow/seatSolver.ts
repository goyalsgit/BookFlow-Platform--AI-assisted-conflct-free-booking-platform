export type SeatRow = { label: string; count: number; blocked: number[] };
export type SeatRequest = { id: number; partySize: number; createdAt: string };
export type SeatSolution = {
  assignments: Map<number, string[]>;
  filled: number;
  fragments: number;
  examined: number;
};

export function seatKeys(rows: SeatRow[]) {
  return rows.flatMap((row) =>
    Array.from({ length: row.count }, (_, i) => i + 1)
      .filter((number) => !row.blocked.includes(number))
      .map((number) => `${row.label}-${number}`),
  );
}

function fragments(rows: SeatRow[], occupied: Set<string>) {
  let runs = 0;
  for (const row of rows) {
    let inGap = false;
    for (let number = 1; number <= row.count; number++) {
      if (row.blocked.includes(number)) {
        inGap = false;
        continue;
      }
      const empty = !occupied.has(`${row.label}-${number}`);
      if (empty && !inGap) runs++;
      inGap = empty;
    }
  }
  return runs;
}

/** Complete branch-and-bound search. Throws instead of publishing an unproved answer. */
export function solveSeats(
  rows: SeatRow[],
  requests: SeatRequest[],
  alreadyOccupied: string[],
  maxNodes = 2_000_000,
): SeatSolution {
  const valid = new Set(seatKeys(rows));
  if (
    alreadyOccupied.some((key) => !valid.has(key)) ||
    new Set(alreadyOccupied).size !== alreadyOccupied.length
  )
    throw new Error('Invalid occupied seat map');
  const occupied = new Set(alreadyOccupied);
  const freeSeats = valid.size - occupied.size;
  const ordered = [...requests].sort(
    (a, b) => b.partySize - a.partySize || a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
  );
  const byAge = [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const candidates = new Map<number, string[][]>();
  for (const request of ordered) {
    const blocks: string[][] = [];
    for (const row of rows)
      for (let start = 1; start + request.partySize - 1 <= row.count; start++) {
        const seats = Array.from(
          { length: request.partySize },
          (_, i) => `${row.label}-${start + i}`,
        );
        if (seats.every((key) => valid.has(key) && !occupied.has(key))) blocks.push(seats);
      }
    candidates.set(request.id, blocks);
  }
  const suffix = new Array(ordered.length + 1).fill(0);
  for (let i = ordered.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + ordered[i].partySize;
  let examined = 0,
    bestFilled = -1,
    bestFragments = Infinity,
    bestTie = '';
  let best = new Map<number, string[]>();
  const chosen = new Map<number, string[]>();
  const tie = () =>
    byAge.map((r) => (chosen.has(r.id) ? `0:${chosen.get(r.id)!.join(',')}` : '1')).join('|');
  const visit = (index: number, filled: number) => {
    if (++examined > maxNodes)
      throw new Error('Allocation could not be proven optimal within the search limit');
    if (filled + Math.min(freeSeats - filled, suffix[index]) < bestFilled) return;
    if (index === ordered.length) {
      const count = fragments(rows, occupied),
        key = tie();
      if (
        filled > bestFilled ||
        (filled === bestFilled &&
          (count < bestFragments || (count === bestFragments && key < bestTie)))
      ) {
        bestFilled = filled;
        bestFragments = count;
        bestTie = key;
        best = new Map(chosen);
      }
      return;
    }
    const request = ordered[index];
    for (const block of candidates.get(request.id)!) {
      if (block.some((key) => occupied.has(key))) continue;
      block.forEach((key) => occupied.add(key));
      chosen.set(request.id, block);
      visit(index + 1, filled + request.partySize);
      chosen.delete(request.id);
      block.forEach((key) => occupied.delete(key));
    }
    visit(index + 1, filled);
  };
  visit(0, 0);
  return { assignments: best, filled: bestFilled, fragments: bestFragments, examined };
}
