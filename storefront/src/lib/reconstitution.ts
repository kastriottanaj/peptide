/**
 * The arithmetic behind /peptid-rechner: turning a vial of lyophilised peptide,
 * a volume of solvent and a target amount per aliquot into a concentration, a
 * volume in ml and a reading on a U-100 syringe scale.
 *
 * Deliberately free of DOM and Astro imports. The page renders its default
 * result from these functions at build time and the island recomputes with the
 * same ones in the browser, so the pre-rendered numbers and the interactive
 * numbers are produced by identical code and cannot disagree.
 *
 * Vocabulary note, and it is not cosmetic: the target is an *Aliquot*, never a
 * dose. This storefront sells research-use-only material, and a calculator is
 * the page most easily misread as usage guidance. Nothing here models body
 * weight, frequency or a schedule — it converts units.
 */

/** A U-100 syringe. `units` is the full scale; 100 units = 1 ml by definition. */
export type SyringeScale = {
	/** Machine-readable id, also the radio value. */
	id: string;
	/** Barrel volume, German decimal comma. */
	label: string;
	/** Full-scale reading, e.g. "30 Units". */
	sub: string;
	units: number;
	/** How the scale reads in practice. */
	helper: string;
};

export const SYRINGE_SCALES: readonly SyringeScale[] = [
	{ id: "30", label: "0,3 ml", sub: "30 Units", units: 30, helper: "Feine Skala" },
	{ id: "50", label: "0,5 ml", sub: "50 Units", units: 50, helper: "Mittlere Skala" },
	{ id: "100", label: "1,0 ml", sub: "100 Units", units: 100, helper: "Volle Skala" },
] as const;

/** Common pack sizes, solvent volumes and aliquot targets, as one-tap presets. */
export const VIAL_PRESETS = ["5", "10", "15"] as const;
export const SOLVENT_PRESETS = ["1", "2", "3", "5"] as const;
export const TARGET_PRESETS = ["50", "100", "250", "500"] as const;

export type ReconstitutionInput = {
	/** Peptide per vial, in mg. */
	vialMg: number;
	/** Solvent added to the vial, in ml. */
	solventMl: number;
	/** Target amount per aliquot, in mcg. */
	targetMcg: number;
	/** Full-scale units of the syringe the result is read on. */
	scaleUnits: number;
};

export type ReconstitutionResult = ReconstitutionInput & {
	/** False until all three amounts are greater than zero. */
	valid: boolean;
	totalMcg: number;
	concentrationMcgMl: number;
	volumeMl: number;
	units: number;
	mcgPerUnit: number;
	/** Whole aliquots obtainable from one vial. */
	aliquots: number;
	/** What is left over after those whole aliquots, in mcg. */
	remainingMcg: number;
	/** Fill along the chosen scale, 0–100, clamped for drawing. */
	fillPct: number;
	/** The reading exceeds the chosen scale and cannot be drawn up in one go. */
	overflow: boolean;
	/** Below ~2 units a U-100 scale stops being legible. */
	lowPrecision: boolean;
	/** Smallest scale that would fit the reading, when one exists. */
	suggestedScale: SyringeScale | null;
};

/** The setup the page renders before any interaction. */
export const DEFAULT_SETUP: ReconstitutionInput = {
	vialMg: 5,
	solventMl: 1,
	targetMcg: 50,
	scaleUnits: 30,
};

/**
 * Read a number the way a German keyboard types one: `2,5` and `2.5` are the
 * same value. Anything unparseable becomes 0, which `calculate` then reports as
 * an invalid setup — an empty field must never reach the markup as `NaN`.
 */
export function parseDecimal(value: string): number {
	const parsed = Number(value.trim().replace(",", "."));
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The single number formatter. Small values keep two decimals so a 0,01 ml
 * result does not collapse to "0"; whole numbers stay unpadded.
 */
export function formatDe(value: number, digits = 2): string {
	return new Intl.NumberFormat("de-DE", {
		maximumFractionDigits: digits,
		minimumFractionDigits: value > 0 && value < 1 ? Math.min(2, digits) : 0,
	}).format(value);
}

/**
 * "1 Unit" but "1,25 Units". Decided from the *formatted* string rather than
 * the raw number, so a value that rounds to 1 for display reads as singular
 * too — 1,0001 shown as "1" followed by "Units" looks like a bug.
 */
export function unitsPhrase(units: number, digits = 2): string {
	const text = formatDe(units, digits);
	return `${text} ${text === "1" ? "Unit" : "Units"}`;
}

export function scaleByUnits(units: number): SyringeScale {
	return SYRINGE_SCALES.find((scale) => scale.units === units) ?? SYRINGE_SCALES[0];
}

export function calculate(input: ReconstitutionInput): ReconstitutionResult {
	const { vialMg, solventMl, targetMcg, scaleUnits } = input;
	const valid = vialMg > 0 && solventMl > 0 && targetMcg > 0;

	if (!valid) {
		return {
			...input,
			valid: false,
			totalMcg: 0,
			concentrationMcgMl: 0,
			volumeMl: 0,
			units: 0,
			mcgPerUnit: 0,
			aliquots: 0,
			remainingMcg: 0,
			fillPct: 0,
			overflow: false,
			lowPrecision: false,
			suggestedScale: null,
		};
	}

	const totalMcg = vialMg * 1000;
	const concentrationMcgMl = totalMcg / solventMl;
	const volumeMl = targetMcg / concentrationMcgMl;
	const units = volumeMl * 100;
	const aliquots = Math.floor(totalMcg / targetMcg);

	return {
		...input,
		valid: true,
		totalMcg,
		concentrationMcgMl,
		volumeMl,
		units,
		mcgPerUnit: concentrationMcgMl / 100,
		aliquots,
		remainingMcg: totalMcg - aliquots * targetMcg,
		fillPct: Math.min((units / scaleUnits) * 100, 100),
		overflow: units > scaleUnits,
		lowPrecision: units > 0 && units < 2,
		suggestedScale: SYRINGE_SCALES.find((scale) => units <= scale.units) ?? null,
	};
}

/**
 * The visible rechenweg. Built from the same result object the outputs come
 * from, so the arithmetic shown to the reader is provably the arithmetic that
 * produced the answer rather than a re-derivation that could drift.
 */
export function formulaSteps(
	result: ReconstitutionResult,
): Array<{ label: string; expression: string }> {
	if (!result.valid) {
		return [
			{ label: "Gesamtmenge", expression: "—" },
			{ label: "Konzentration", expression: "—" },
			{ label: "Volumen", expression: "—" },
			{ label: "U-100-Units", expression: "—" },
		];
	}

	return [
		{
			label: "Gesamtmenge",
			expression: `${formatDe(result.vialMg)} mg × 1000 = ${formatDe(result.totalMcg, 0)} mcg`,
		},
		{
			label: "Konzentration",
			expression: `${formatDe(result.totalMcg, 0)} mcg ÷ ${formatDe(result.solventMl)} ml = ${formatDe(result.concentrationMcgMl)} mcg/ml`,
		},
		{
			label: "Volumen",
			expression: `${formatDe(result.targetMcg, 0)} mcg ÷ ${formatDe(result.concentrationMcgMl)} mcg/ml = ${formatDe(result.volumeMl, 3)} ml`,
		},
		{
			label: "U-100-Units",
			expression: `${formatDe(result.volumeMl, 3)} ml × 100 = ${unitsPhrase(result.units)}`,
		},
	];
}

/**
 * Tick marks for one scale: every unit, with a longer labelled tick at each
 * major step. Returned as data rather than markup so the component draws them
 * and the island redraws them from one definition.
 */
export function scaleTicks(scaleUnits: number): Array<{ at: number; major: boolean }> {
	const majorStep = scaleUnits <= 30 ? 5 : scaleUnits <= 50 ? 10 : 20;
	return Array.from({ length: scaleUnits + 1 }, (_, index) => ({
		at: index,
		major: index % majorStep === 0,
	}));
}
