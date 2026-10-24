import { createClient } from "@libsql/client";
const url = process.env.DB_LOCAL_URL,
	email = process.env.ADMIN_EMAIL,
	role = process.env.ADMIN_ROLE;
if (
	!url?.startsWith("file:") ||
	!email ||
	!["admin", "user"].includes(role || "")
)
	throw new Error("Invalid exact local admin target.");
const client = createClient({ url });
try {
	const result = await client.batch(
		[
			{
				sql: "UPDATE user SET role=? WHERE email=?",
				args: [role || "", email],
			},
			{ sql: "SELECT id,email,role FROM user WHERE email=?", args: [email] },
		],
		"write",
	);
	console.log(JSON.stringify([{ results: result[1].rows }]));
} finally {
	client.close();
}
