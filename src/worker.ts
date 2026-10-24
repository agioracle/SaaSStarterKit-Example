import handler from "@tanstack/react-start/server-entry";
import type { Bindings } from "./env";
import { runMaintenance } from "./maintenance.server";
/** Keep Start's official fetch entry, add only the Workers scheduled lifecycle. */
export default {
	fetch(request: Request) {
		return handler.fetch(request);
	},
	async scheduled(_controller: ScheduledController, env: Bindings) {
		await runMaintenance(env);
	},
} satisfies ExportedHandler<Bindings>;
