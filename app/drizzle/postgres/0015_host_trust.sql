CREATE TABLE "tandem_ssh_trust" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"profile_scope" text NOT NULL,
	"address" text NOT NULL,
	"port" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"key_type" text NOT NULL,
	"revision" integer NOT NULL,
	"approved_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_data" ALTER COLUMN "enable_session_logging" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "tandem_ssh_trust" ADD CONSTRAINT "tandem_ssh_trust_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;