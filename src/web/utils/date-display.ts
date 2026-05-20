const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Regex for datetime with optional timezone offset.
 * Matches: YYYY-MM-DD HH:mm, YYYY-MM-DDTHH:mm, YYYY-MM-DD HH:mm+HH:mm, YYYY-MM-DDTHH:mm-HH:mm
 */
const DATE_TIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?:[+-]\d{2}:\d{2})?$/;

function parseIntStrict(val: string): number {
	return Number.parseInt(val, 10);
}

/**
 * Parse a stored date string into a Date object.
 * Accepts ISO 8601 with or without timezone offset.
 * Uses native Date parsing for datetime strings (handles ISO 8601 correctly
 * including timezone offsets), and manual UTC parsing for date-only strings.
 */
export function parseStoredDate(dateStr: string): Date | null {
	const normalized = dateStr.trim();
	if (!normalized) return null;

	// Date-only: parse with UTC to avoid timezone shift
	const dateOnlyMatch = normalized.match(DATE_ONLY_REGEX);
	if (dateOnlyMatch) {
		const y = dateOnlyMatch[1];
		const m = dateOnlyMatch[2];
		const d = dateOnlyMatch[3];
		if (!y || !m || !d) return null;
		const year = parseIntStrict(y);
		const month = parseIntStrict(m);
		const day = parseIntStrict(d);
		const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
		if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
			return null;
		}
		return date;
	}

	// Datetime with optional offset — parse and validate
	const dateTimeMatch = normalized.match(DATE_TIME_REGEX);
	if (dateTimeMatch) {
		const y = dateTimeMatch[1];
		const m = dateTimeMatch[2];
		const d = dateTimeMatch[3];
		if (!y || !m || !d) return null;
		const year = parseIntStrict(y);
		const month = parseIntStrict(m);
		const day = parseIntStrict(d);

		const parsed = new Date(normalized);
		if (Number.isNaN(parsed.getTime())) {
			return null;
		}

		// Validate that the date components match (catches overflow like Feb 31)
		if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
			return null;
		}

		return parsed;
	}

	return null;
}

/**
 * Parse a stored date string into a Date, assuming stored as UTC.
 * Legacy alias — delegates to parseStoredDate.
 * @deprecated Use parseStoredDate instead.
 */
export function parseStoredUtcDate(dateStr: string): Date | null {
	return parseStoredDate(dateStr);
}

export function formatStoredUtcDateForDisplay(dateStr: string): string {
	const parsed = parseStoredDate(dateStr);
	if (!parsed) return dateStr;
	if (DATE_TIME_REGEX.test(dateStr.trim())) {
		return parsed.toLocaleString(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		});
	}
	return parsed.toLocaleDateString();
}

export function formatStoredUtcDateForCompactDisplay(dateStr: string, now: Date = new Date()): string {
	const normalized = dateStr.trim();
	if (!normalized) return "—";
	const parsed = parseStoredDate(normalized);
	if (!parsed) return normalized;

	const diffMs = now.getTime() - parsed.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays >= 0) {
		if (diffDays === 0) return "today";
		if (diffDays === 1) return "yesterday";
		if (diffDays < 7) return `${diffDays}d ago`;
	}

	return parsed.toLocaleDateString();
}
