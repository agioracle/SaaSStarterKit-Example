import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/** Runs ONLY against the disposable checkout created by prepareLocalSmoke. */
export function installLuminaFixtures(target: string) {
	if (!target.includes(`${join("", ".local-smoke")}/run-`))
		throw Error("Lumina fixtures require an isolated local smoke checkout.");
	const edit = (name: string, before: string, after: string) => {
		const path = join(target, name);
		const source = readFileSync(path, "utf8");
		if (!source.includes(before)) throw Error(`Fixture seam changed: ${name}`);
		writeFileSync(path, source.replace(before, after));
	};
	// Original geometric artwork, encoded locally. It is never a provider result.
	const crc = (bytes: Buffer) => {
		let n = 0xffffffff;
		for (const b of bytes) {
			n ^= b;
			for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
		}
		return (n ^ 0xffffffff) >>> 0;
	};
	const chunk = (name: string, value: Buffer) => {
		const data = Buffer.concat([Buffer.from(name), value]);
		const size = Buffer.alloc(4);
		size.writeUInt32BE(value.length);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(data));
		return Buffer.concat([size, data, sum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(256, 0);
	header.writeUInt32BE(256, 4);
	header[8] = 8;
	header[9] = 2;
	const rows: Buffer[] = [];
	for (let y = 0; y < 256; y++) {
		const row = Buffer.alloc(769);
		for (let x = 0; x < 256; x++) {
			const circle = (x - 140) ** 2 + (y - 105) ** 2 < 65 ** 2;
			const arch = x > 55 && x < 115 && y > 100;
			const color = circle
				? [185, 102, 73]
				: arch
					? [101, 128, 105]
					: [240, 231, 209];
			for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = color[c];
		}
		rows.push(row);
	}
	const png = Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(Buffer.concat(rows))),
		chunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
	writeFileSync(
		join(target, "src/generation/local-fixture.server.ts"),
		`
import type { Transport } from './providers.server';
const png = Uint8Array.from(atob('${png}'), c => c.charCodeAt(0));
export const fixtureTransport: Transport = async (url, init) => {
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.prompt.includes('[fixture:unknown]')) throw Error('Local fixture: uncertain dispatch');
    if (body.prompt.includes('[fixture:fail]')) return Response.json({}, { status: 422 });
    const scenario = body.prompt.includes('[fixture:pending]') ? 'pending' : 'success';
    if (url.startsWith('https://api.cloudflare.com/')) return Response.json({ success: true, result: { image: '${png}' } });
    return Response.json({ request_id: 'fixture-' + scenario + '-' + crypto.randomUUID() });
  }
  if (url.startsWith('https://queue.fal.run/')) {
    if (url.endsWith('/status')) return Response.json({ status: url.includes('fixture-pending-') ? 'IN_QUEUE' : 'COMPLETED' });
    return Response.json({ has_nsfw_concepts: [false], images: [{ url: 'https://fal.media/local-fixture.png', width: 256, height: 256 }] });
  }
  if (url === 'https://fal.media/local-fixture.png') return new Response(png, { headers: { 'content-type': 'image/png' } });
  throw Error('Local fixture refused an unexpected network target');
};
`,
	);
	// The production tree has neither this import nor fixture dispatch branches.
	edit(
		"src/api/generation.server.ts",
		'import { z } from "zod";',
		'import { z } from "zod";\nimport { fixtureTransport } from "../generation/local-fixture.server";',
	);
	edit(
		"src/api/generation.server.ts",
		"await createGeneration(env, userId, await readJson(request, 12_000))",
		"await createGeneration(env, userId, await readJson(request, 12_000), fixtureTransport)",
	);
	edit(
		"src/api/generation.server.ts",
		"refreshGeneration(env, userId, id)",
		"refreshGeneration(env, userId, id, fixtureTransport)",
	);
	edit(
		"src/api/generation.server.ts",
		"\tconst url = new URL(request.url);",
		'\tconst url = new URL(request.url);\n if (env.APP_ENV !== "test" || url.hostname !== "127.0.0.1") throw new HttpError(404, "Local fixture only.");',
	);
	edit(
		"src/generation/providers.server.ts",
		'return validateImage(bytes, "image/jpeg");',
		'return validateImage(bytes, "image/png");',
	);
	edit(
		"src/config/website.ts",
		"ai: { ...DEFAULT_AI_POLICY, userConcurrent: 2 },",
		"ai: { ...DEFAULT_AI_POLICY, enabled: true, userConcurrent: 2 },",
	);
	edit(
		"src/components/layout/shell.tsx",
		'<header className="site-header">',
		'<header className="site-header">\n<div role="status" className="fixture-banner">LOCAL FIXTURE · 本地演示数据，非 AI 生成 / Test data, not AI-generated</div>',
	);
	const config = join(target, "wrangler.jsonc");
	const json = JSON.parse(readFileSync(config, "utf8"));
	json.vars.IMAGE_GENERATION_ENABLED = "true";
	json.vars.FAL_API_KEY = "fixture-local-no-network";
	json.vars.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
	json.vars.CLOUDFLARE_AI_API_TOKEN = "fixture-local-no-network";
	writeFileSync(config, JSON.stringify(json, null, 2));
	writeFileSync(
		join(target, "LUMINA-FIXTURE-ONLY.txt"),
		"LOCAL TEST FIXTURE. Never deploy or publish this generated checkout. Uses real authentication, local D1/R2, normal product quotas and a transport that never sends provider requests.\n",
	);
	const css = join(target, "src/styles.css");
	writeFileSync(
		css,
		readFileSync(css, "utf8") +
			"\n.fixture-banner { width:100%; padding:10px; background:#fff3c4; color:#473600; text-align:center; font:12px system-ui; }\n.site-header:has(.fixture-banner) { flex-wrap:wrap; }\n",
	);
}
