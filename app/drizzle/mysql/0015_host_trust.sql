CREATE TABLE `tandem_ssh_trust` (
	`id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`profile_scope` text NOT NULL,
	`address` text NOT NULL,
	`port` int NOT NULL,
	`fingerprint` text NOT NULL,
	`key_type` text NOT NULL,
	`revision` int NOT NULL,
	`approved_at` text NOT NULL,
	CONSTRAINT `tandem_ssh_trust_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ssh_data` MODIFY COLUMN `enable_session_logging` boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `tandem_ssh_trust` ADD CONSTRAINT `tandem_ssh_trust_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;