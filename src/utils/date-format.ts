/**
 * Format the current local time as ISO 8601 with timezone offset.
 * Produces e.g. "2026-05-21T04:29+09:00" for JST.
 * Uses space separator for backward-compat with the old format.
 */
export function formatLocalDate(): string {
	const now = new Date();
	const offset = -now.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const absOffset = Math.abs(offset);
	const tzHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
	const tzMinutes = String(absOffset % 60).padStart(2, "0");

	// Convert to local time by shifting by the offset
	const localMs = now.getTime() + offset * 60 * 1000;
	const localDate = new Date(localMs);
	const iso = localDate.toISOString().slice(0, 16); // "2026-05-21T04:29"

	return `${iso.replace("T", " ")}${sign}${tzHours}:${tzMinutes}`;
}
