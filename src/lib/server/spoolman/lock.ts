/**
 * One writer at a time per workspace Spoolman. Deducting grams is read-ledger, call Spoolman,
 * write-ledger: two overlapping syncs of the same run (a double click, a printer finishing while
 * the maker logs it) would both read the old ledger and both deduct. This serialises them in this
 * process (the app runs as one process). A failing job never blocks the next one.
 */
const tails = new Map<string, Promise<unknown>>();

export function withSpoolmanLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = tails.get(key) ?? Promise.resolve();
	const run = prev.then(fn, fn);
	const tail = run.catch(() => {});
	tails.set(key, tail);
	void tail.then(() => {
		if (tails.get(key) === tail) tails.delete(key);
	});
	return run;
}
