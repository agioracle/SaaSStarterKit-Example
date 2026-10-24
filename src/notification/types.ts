export interface PaymentNotification {
	sessionId: string;
	customerId: string;
	userName: string;
	/** Integer minor currency units, e.g. 1999 = USD 19.99, 1999 = JPY 1999. */
	amount: number;
	currency: string;
	/** Use Amount paid only for verified event amounts, not catalogue plan prices. */
	amountLabel?: "Configured plan price" | "Amount paid";
}
export interface NotificationConfig {
	discordWebhookUrl?: string;
	feishuWebhookUrl?: string;
	feishuSecret?: string;
}
export type NotificationChannel = "discord" | "feishu";
export interface NotificationDelivery {
	channel: NotificationProviderName;
	accepted: boolean;
	error?: string;
}
export interface NotificationService {
	sendPaymentNotification(
		input: PaymentNotification,
	): Promise<NotificationDelivery[]>;
}

/** Public provider extension contract: amount is in MAJOR units (19.99 USD), unlike PaymentNotification. */
export interface SendPaymentNotificationParams {
	sessionId: string;
	customerId: string;
	userName: string;
	amount: number;
	/** The documented example is USD; other currencies must be stated explicitly. */
	currency?: string;
	amountLabel?: PaymentNotification["amountLabel"];
}
export interface NotificationProvider {
	getProviderName(): string;
	sendPaymentNotification(input: SendPaymentNotificationParams): Promise<void>;
}
export interface NotificationProviderNames {
	discord: true;
	feishu: true;
}
export type NotificationProviderName = keyof NotificationProviderNames;
