CREATE TABLE "oauth_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(64) NOT NULL,
	"state_hash" text NOT NULL,
	"browser_binding_hash" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"return_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "oauth_login_attempts_expires_after_create" CHECK ("oauth_login_attempts"."expires_at" > "oauth_login_attempts"."created_at"),
	CONSTRAINT "oauth_login_attempts_consumed_after_create" CHECK ("oauth_login_attempts"."consumed_at" IS NULL OR "oauth_login_attempts"."consumed_at" >= "oauth_login_attempts"."created_at"),
	CONSTRAINT "oauth_login_attempts_provider_nonblank" CHECK (length(btrim("oauth_login_attempts"."provider")) > 0),
	CONSTRAINT "oauth_login_attempts_return_path_local" CHECK (left("oauth_login_attempts"."return_path", 1) = '/' AND left("oauth_login_attempts"."return_path", 2) <> '//')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_login_attempts_state_hash_uidx" ON "oauth_login_attempts" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "oauth_login_attempts_expires_idx" ON "oauth_login_attempts" USING btree ("expires_at");