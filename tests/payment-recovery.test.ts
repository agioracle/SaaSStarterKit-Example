import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	runPaymentRecovery,
	type PaymentRecoveryOptions,
} from "../scripts/payment-recovery";
let root: string;
let file: string;
let client: Client;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "payment-recovery-fixture-"));
	const directory = join(root, ".wrangler/state/v3/d1");
	await mkdir(directory, { recursive: true });
	file = join(directory, "fixture.sqlite");
	client = createClient({ url: pathToFileURL(file).href });
	for (const name of (await readdir(new URL("../drizzle", import.meta.url)))
		.filter((value) => value.endsWith(".sql"))
		.sort())
		for (const sql of (
			await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")
		)
			.split("--> statement-breakpoint")
			.map((value) => value.trim())
			.filter(Boolean))
			await client.executeMultiple(sql);
	await client.execute(
		"INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('fixture','Fixture','fixture@example.test',1,1,1)",
	);
});
afterEach(async () => {
	client.close();
	await rm(root, { recursive: true, force: true });
});
const options = (): PaymentRecoveryOptions => ({
	action: "adopt-namespace",
	file,
	provider: "stripe",
	mode: "test",
	deployment: "fixture-deployment",
	accountFingerprint: "a".repeat(64),
});
const dependencies = () => ({ cwd: root, log: () => {} });
describe("reviewed local payment recovery", () => {
	it("defaults to dry run without adopting a namespace", async () => {
		await runPaymentRecovery(options(), dependencies());
		expect(
			(await client.execute("SELECT count(*) AS count FROM payment_namespaces"))
				.rows[0].count,
		).toBe(0);
	});
	it("requires exact target, namespace tuple, offline worker and reviewed ledger", async () => {
		await expect(
			runPaymentRecovery({ ...options(), execute: true }, dependencies()),
		).rejects.toThrow("confirm-target");
		await expect(
			runPaymentRecovery(
				{ ...options(), execute: true, confirmTarget: file },
				dependencies(),
			),
		).rejects.toThrow("worker-stopped");
		await expect(
			runPaymentRecovery(
				{
					...options(),
					execute: true,
					confirmTarget: file,
					workerStopped: true,
				},
				dependencies(),
			),
		).rejects.toThrow("verified-existing-ledger");
		await runPaymentRecovery(
			{
				...options(),
				execute: true,
				confirmTarget: file,
				workerStopped: true,
				verifiedExistingLedger: true,
				confirmNamespace: `fixture-deployment|test|stripe|${"a".repeat(64)}`,
			},
			dependencies(),
		);
		expect(
			(await client.execute("SELECT count(*) AS count FROM payment_namespaces"))
				.rows[0].count,
		).toBe(2);
	});
	it("refuses to rebrand an adopted namespace", async () => {
		await client.execute(
			"INSERT INTO payment_namespaces(provider,mode,account) VALUES('__deployment__','test','old-deployment')",
		);
		await expect(
			runPaymentRecovery(
				{
					...options(),
					execute: true,
					confirmTarget: file,
					workerStopped: true,
					verifiedExistingLedger: true,
					confirmNamespace: `fixture-deployment|test|stripe|${"a".repeat(64)}`,
				},
				dependencies(),
			),
		).rejects.toThrow("immutable namespace");
	});
	it("rebuilds at most two missing projections and resumes without inventing payment facts", async () => {
		const plan = JSON.stringify({
			id: "monthly",
			priceId: "fixture-price",
			kind: "subscription",
			amount: 990,
			currency: "USD",
		});
		for (let index = 0; index < 3; index++)
			await client.execute({
				sql: "INSERT INTO payment_checkouts(reference,user_id,provider,plan,created_at) VALUES(?,'fixture','stripe',?,1)",
				args: [`fixture-${index}`, plan],
			});
		const logs: string[] = [];
		const config: PaymentRecoveryOptions = {
			action: "rebuild",
			file,
			execute: true,
			confirmTarget: file,
			workerStopped: true,
		};
		await runPaymentRecovery(config, {
			cwd: root,
			log: (value) => logs.push(value),
		});
		expect(logs.at(-1)).toBe('{"rebuilt":2,"remaining":true}');
		await runPaymentRecovery(config, {
			cwd: root,
			log: (value) => logs.push(value),
		});
		expect(logs.at(-1)).toBe('{"rebuilt":1,"remaining":false}');
		expect(
			(await client.execute("SELECT count(*) AS count FROM payment_events"))
				.rows[0].count,
		).toBe(0);
		expect(
			(
				await client.execute(
					"SELECT count(*) AS count FROM payment_checkouts WHERE lifecycle='unknown'",
				)
			).rows[0].count,
		).toBe(3);
	});
	it("provides reference-specific provider recovery guidance without modifying the DB", async () => {
		const logs: string[] = [];
		await runPaymentRecovery(
			{
				action: "reconcile-help",
				provider: "creem",
				reference: "fixture-checkout",
			},
			{ log: (value) => logs.push(value) },
		);
		expect(logs.join(" ")).toContain(
			"sessionId=THE_VERIFIED_PROVIDER_SESSION_ID",
		);
		expect(logs.join(" ")).toContain("exact reference");
	});
	it("prints only a fingerprint using injected synthetic namespace credentials", async () => {
		const logs: string[] = [];
		await runPaymentRecovery(
			{ action: "namespace-plan", provider: "stripe" },
			{
				env: {
					STRIPE_SECRET_KEY: "sk_test_fixture_not_real",
					PAYMENT_MODE: "test",
					APP_URL: "https://fixture.example.test",
				},
				log: (value) => logs.push(value),
			},
		);
		expect(JSON.parse(logs[0])).toMatchObject({
			mode: "test",
			deployment: "https://fixture.example.test",
			account: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(logs.join(" ")).not.toContain("sk_test_fixture_not_real");
	});
	it("rejects an explicitly mistyped mode instead of silently claiming test", async () => {
		await expect(
			runPaymentRecovery(
				{ action: "namespace-plan", provider: "stripe" },
				{
					env: { STRIPE_SECRET_KEY: "sk_test_fixture", PAYMENT_MODE: "liv" },
					log: () => {},
				},
			),
		).rejects.toMatchObject({ code: "CONFIGURATION" });
	});
});
