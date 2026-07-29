/**
 * Static output must not depend on the instant at which `astro build` happens.
 * Production deploys set SOURCE_DATE_EPOCH to the source commit timestamp.
 * Direct developer builds retain the old current-time behavior when the
 * reproducible-build variable is absent.
 */
function resolveBuildTime(): number {
	const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
	if (sourceDateEpoch === undefined) return Date.now();
	if (!/^[1-9][0-9]{0,11}$/.test(sourceDateEpoch)) {
		throw new Error("SOURCE_DATE_EPOCH must be a positive Unix timestamp.");
	}

	const milliseconds = Number(sourceDateEpoch) * 1000;
	if (!Number.isSafeInteger(milliseconds)) {
		throw new Error("SOURCE_DATE_EPOCH is outside the supported range.");
	}
	const candidate = new Date(milliseconds);
	if (Number.isNaN(candidate.getTime())) {
		throw new Error("SOURCE_DATE_EPOCH is outside the supported date range.");
	}
	return milliseconds;
}

const BUILD_TIME_MS = resolveBuildTime();

/** Return a fresh Date so callers cannot mutate shared build state. */
export function buildDate(): Date {
	return new Date(BUILD_TIME_MS);
}

export const BUILD_DATE = new Date(BUILD_TIME_MS).toISOString().slice(0, 10);
export const BUILD_YEAR = new Date(BUILD_TIME_MS).getUTCFullYear();
