/** Local-only payment maintenance. No provider calls, remote migrations, or automatic
 * lifecycle overrides. Stop the local Worker before modifying its SQLite database. */
import {
	createClient,
	type Client,
	type InValue,
	type ResultSet,
} from "@libsql/client";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { findLocalDatabase } from "./db-studio";
import {
	checkPaymentNamespace,
	rebuildPaymentProjectionBatch,
	rebuildPaymentProjection,
} from "../src/db/payment-store";
import { paymentNamespaceIdentity } from "../src/payment/namespace";
import type { PaymentMode, PaymentProviderId } from "../src/payment/types";
export interface PaymentRecoveryOptions {
	action:
		| "namespace-plan"
		| "inspect"
		| "adopt-namespace"
		| "rebuild"
		| "reconcile-help";
	file?: string;
	execute?: boolean;
	confirmTarget?: string;
	confirmNamespace?: string;
	verifiedExistingLedger?: boolean;
	workerStopped?: boolean;
	provider?: PaymentProviderId;
	mode?: PaymentMode;
	deployment?: string;
	accountFingerprint?: string;
	reference?: string;
}
function d1Result(result: ResultSet): D1Result {
	return {
		success: true,
		results: result.rows.map((row) => ({ ...row })),
		meta: {
			changes: result.rowsAffected,
			duration: 0,
			last_row_id: Number(result.lastInsertRowid ?? 0),
			changed_db: result.rowsAffected > 0,
			size_after: 0,
			rows_read: result.rows.length,
			rows_written: result.rowsAffected,
		},
	};
}
/** libSQL batch('write') is transactional; this adapter is only for the local maintenance CLI. */
export function recoveryDatabase(client: Client): D1Database {
	class Statement {
		constructor(
			readonly sql: string,
			readonly args: InValue[] = [],
		) {}
		bind(...values: unknown[]) {
			return new Statement(this.sql, values as InValue[]);
		}
		async run() {
			return d1Result(await client.execute({ sql: this.sql, args: this.args }));
		}
		async all() {
			return this.run();
		}
		async first(column?: string) {
			const result = await this.run();
			const row = result.results?.[0] as Record<string, unknown> | undefined;
			return row ? (column ? row[column] : row) : null;
		}
	}
	return {
		prepare(sql: string) {
			return new Statement(sql);
		},
		async batch(statements: Statement[]) {
			return (
				await client.batch(
					statements.map((statement) => ({
						sql: statement.sql,
						args: statement.args,
					})),
					"write",
				)
			).map(d1Result);
		},
	} as unknown as D1Database;
}
export async function runPaymentRecovery(
	options: PaymentRecoveryOptions,
	dependencies: {
		cwd?: string;
		env?: Record<string, string | undefined>;
		log?: (message: string) => void;
	} = {},
) {
	const cwd = dependencies.cwd ?? process.cwd();
	const log = dependencies.log ?? console.log;
	if (options.action === "namespace-plan") {
		if (!options.provider) throw Error("Namespace plan requires --provider.");
		const namespace = await paymentNamespaceIdentity(
			dependencies.env ?? process.env,
			options.provider,
		);
		log(JSON.stringify({ provider: options.provider, ...namespace }));
		log(
			"Only the SHA-256 identity fingerprint is shown, never the credential. Review mode/account and isolated database history before adopting this tuple.",
		);
		return;
	}
	if (options.action === "reconcile-help") {
		if (!options.provider || !options.reference)
			throw Error("Reconciliation help requires --provider and --reference.");
		log(
			`Owned checkout: ${options.provider}/${options.reference}. Use the authenticated billing page’s Check status action. Never supply a payment status from the browser.`,
		);
		if (options.provider === "waffo")
			log(
				"Waffo has no verified checkout-retrieval contract in this adapter. Ask Waffo support to resolve the exact merchant external reference and resend any terminal/cancellation webhook. Unknown remains blocked; this command cannot mark it failed.",
			);
		else
			log(
				`If the checkout ID was lost, obtain the original session ID from ${options.provider} support and submit an authenticated same-origin POST /api/payments with action=reconcile, provider=${options.provider}, reference=${options.reference}, sessionId=THE_VERIFIED_PROVIDER_SESSION_ID. The server retrieves it and checks mode and exact reference. Never use a new session or paste credentials.`,
			);
		log(
			"For retry failures, fix the safe recorded error/configuration, then request provider webhook redelivery. Recovery never treats age or an empty list as proof of no subscription.",
		);
		return;
	}
	const target = findLocalDatabase(cwd, options.file);
	log(
		`Local payment maintenance target: ${target}. Action: ${options.action}. No remote/provider operation is supported.`,
	);
	const namespace =
		options.action === "adopt-namespace"
			? `${options.deployment}|${options.mode}|${options.provider}|${options.accountFingerprint}`
			: undefined;
	if (namespace) log(`Exact namespace confirmation: ${namespace}`);
	if (!options.execute) {
		log(
			"Dry run only. No database was opened or changed. Apply current local migrations and back up the exact database before execution. Rebuild handles at most two missing projections per run; repeat while remaining=true.",
		);
		return;
	}
	if (options.confirmTarget !== target)
		throw Error(
			"Execution requires --confirm-target matching the exact displayed local SQLite path.",
		);
	if (options.action !== "inspect" && !options.workerStopped)
		throw Error(
			"Stop the local Worker and pass --worker-stopped before maintenance.",
		);
	if (options.action === "adopt-namespace") {
		if (
			!options.provider ||
			!options.mode ||
			!options.deployment ||
			!/^[a-f0-9]{64}$/.test(options.accountFingerprint ?? "")
		)
			throw Error(
				"Adoption requires provider, mode, deployment namespace, and the SHA-256 credential identity fingerprint.",
			);
		if (
			!options.verifiedExistingLedger ||
			options.confirmNamespace !== namespace
		)
			throw Error(
				"Review existing ledger mode/account evidence, then pass --verified-existing-ledger and --confirm-namespace matching the exact displayed tuple. This must not rebrand test data as live.",
			);
	}
	const client = createClient({ url: pathToFileURL(target).toString() });
	const db = recoveryDatabase(client);
	try {
		if (options.action === "inspect") {
			const counts = await client.execute(
				"SELECT lifecycle,count(*) AS count FROM payment_checkouts GROUP BY lifecycle",
			);
			const failures = await client.execute(
				"SELECT provider,code,count(*) AS count,min(last_at) AS oldest FROM payment_webhook_failures GROUP BY provider,code",
			);
			const missing = await client.execute(
				"SELECT count(*) AS count FROM payment_checkouts WHERE snapshot IS NULL",
			);
			log(
				JSON.stringify({
					lifecycle: counts.rows,
					failures: failures.rows,
					missingProjections: missing.rows,
				}),
			);
			return;
		}
		if (options.action === "adopt-namespace") {
			const { provider, mode, deployment, accountFingerprint } = options;
			if (!provider || !mode || !deployment || !accountFingerprint)
				throw Error("Missing verified namespace tuple.");
			const existing = await client.execute({
				sql: "SELECT provider,mode,account FROM payment_namespaces WHERE provider IN ('__deployment__',?)",
				args: [provider],
			});
			for (const row of existing.rows)
				if (
					row.mode !== options.mode ||
					row.account !==
						(row.provider === "__deployment__"
							? options.deployment
							: options.accountFingerprint)
				)
					throw Error(
						"Existing immutable namespace differs. Credential rotation or account migration requires a separately reviewed migration; adoption never overwrites it.",
					);
			await client.batch(
				[
					{
						sql: "INSERT OR IGNORE INTO payment_namespaces(provider,mode,account) VALUES('__deployment__',?,?)",
						args: [mode, deployment],
					},
					{
						sql: "INSERT OR IGNORE INTO payment_namespaces(provider,mode,account) VALUES(?,?,?)",
						args: [provider, mode, accountFingerprint],
					},
				],
				"write",
			);
			await checkPaymentNamespace(
				db,
				provider,
				mode,
				accountFingerprint,
				deployment,
			);
			log(
				"Verified local namespace adoption. No payment facts or lifecycle statuses changed.",
			);
			return;
		}
		if (options.reference) {
			if (!options.provider)
				throw Error("Exact-checkout rebuild requires --provider.");
			await rebuildPaymentProjection(db, options.provider, options.reference);
			log(
				"Rebuilt the exact checkout projection and indexed historical references from its existing ledger.",
			);
		} else log(JSON.stringify(await rebuildPaymentProjectionBatch(db)));
	} finally {
		client.close();
	}
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
	const { values } = parseArgs({
		options: {
			action: { type: "string", default: "inspect" },
			file: { type: "string" },
			execute: { type: "boolean" },
			"confirm-target": { type: "string" },
			"confirm-namespace": { type: "string" },
			"verified-existing-ledger": { type: "boolean" },
			"worker-stopped": { type: "boolean" },
			provider: { type: "string" },
			mode: { type: "string" },
			deployment: { type: "string" },
			"account-fingerprint": { type: "string" },
			reference: { type: "string" },
		},
	});
	if (
		![
			"namespace-plan",
			"inspect",
			"adopt-namespace",
			"rebuild",
			"reconcile-help",
		].includes(values.action ?? "") ||
		(values.provider &&
			!["stripe", "creem", "waffo"].includes(values.provider)) ||
		(values.mode && !["test", "live"].includes(values.mode))
	)
		throw Error("Invalid payment recovery action/provider/mode.");
	runPaymentRecovery({
		action: values.action as PaymentRecoveryOptions["action"],
		file: values.file,
		execute: values.execute,
		confirmTarget: values["confirm-target"],
		confirmNamespace: values["confirm-namespace"],
		verifiedExistingLedger: values["verified-existing-ledger"],
		workerStopped: values["worker-stopped"],
		provider: values.provider as PaymentProviderId | undefined,
		mode: values.mode as PaymentMode | undefined,
		deployment: values.deployment,
		accountFingerprint: values["account-fingerprint"],
		reference: values.reference,
	}).catch(() => {
		console.error(
			"Payment recovery stopped. Check the exact local target, confirmations, current migrations, and immutable namespace. No provider request was made.",
		);
		process.exitCode = 1;
	});
}
