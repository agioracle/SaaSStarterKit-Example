import { pathToFileURL } from "node:url";
import { parseArgs } from "./cli/config.ts";
import { runCli } from "./cli/runner.ts";

export const HELP = `Independent Cloudflare SaaS setup CLI (dry-run by default)

Usage: npm run setup -- <command> [project] [options]
Commands: create, doctor, plan, apply, resume, adopt, configure, migrate,
          build, deploy, sync-worker-secrets, sync-github-secrets, repo, push, delete

--execute                  Enable only the selected stages; otherwise no mutations
--confirm PROJECT          Exact project confirmation required with --execute
--allow STAGE,...           Explicit capabilities; no wildcard or blanket --yes
--steps STAGE,...           apply/resume/plan stages, ordered by dependencies
--directory PATH           Existing project root; create may copy this local starter
--config PATH              Local non-secret manifest (default .saas/setup.json)
--state PATH               Local ID/progress journal (default .saas/state.json)
--account-id ID             Cloudflare account; token is read only from shell
--domain HOST              Exact Cloudflare custom-domain host
--origin https://HOST      Production origin, required for configuration
--repo OWNER/NAME          Exact private repository for repo/push/GitHub sync
--github-environment NAME  Optional existing GitHub Actions environment
--database-id UUID          Explicit adoption of an existing D1 database
--bucket NAME              Explicit adoption of an existing R2 bucket
--kv-id ID                 Explicit adoption of an existing KV namespace
--env-file PATH             Required for secret sync; never bulk-reads shell
--public-vars              Sync allowlisted VITE_* as GitHub variables
--clear-public KEY,KEY      Explicitly delete only these public variables; verify read-back
--credentials              Sync Cloudflare CI token as a GitHub secret; account as variable
--runtime-secrets          Explicitly include runtime values in GitHub Secrets
--remote                   migrate: target remote D1 (otherwise isolated local target)
--profile NAME             doctor: local-preview (default), auth, or deploy
--check-auth               doctor: opt in to read-only Cloudflare/GitHub auth checks
--delete-resources KINDS    Explicit d1,r2,kv subset; only CLI-created resources
--confirm-delete PHRASE     Additional exact 'DELETE PROJECT' confirmation
--payment none|manual      Waffo/Stripe/Creem product provisioning is manual

Stages: provision,configure,install,migrate-local,migrate-remote,build,deploy,
        worker-secrets,github-secrets,repo,push

apply/resume default to provision,configure only. deploy selects build,deploy.
create only copies local original starter/config examples, never a paid template.
Deletion requires explicit resource kinds and double confirmation; adopted resources are never deletion targets.
See scripts/README.md for exact safety guarantees, examples, and limitations.
`;

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(HELP);
		return;
	}
	await runCli(options);
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		console.error(
			`Setup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		process.exitCode = 1;
	});
}
