/** Single mailbox only. Reject controls/header injection and lists, not merely CR/LF. */
export function parseMailbox(value: string): {
	address: string;
	displayName?: string;
} {
	if (
		typeof value !== "string" ||
		Array.from(value).some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		)
	)
		throw new Error("Invalid email mailbox");
	const mailbox = value.trim();
	if (!mailbox || mailbox.length > 320)
		throw new Error("Invalid email mailbox");
	const named = /^([^<>]+)\s*<([^<>]+)>$/.exec(mailbox);
	const address = (named ? named[2] : mailbox).trim().toLowerCase();
	if (
		address.length > 254 ||
		!/^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/.test(address)
	)
		throw new Error("Invalid email mailbox");
	let displayName = named?.[1].trim();
	if (displayName) {
		if (displayName.startsWith('"') && displayName.endsWith('"'))
			displayName = displayName.slice(1, -1);
		if (!displayName || /[<>"\\,;]/.test(displayName))
			throw new Error("Invalid email mailbox");
	}
	return { address, ...(displayName ? { displayName } : {}) };
}
export function getMailtoUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		return `mailto:${parseMailbox(value).address}`;
	} catch {
		return undefined;
	}
}
