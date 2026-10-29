CREATE TABLE "autograph_cleanup_schedule" (
	"id" integer PRIMARY KEY NOT NULL,
	"next_source" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "autograph_cleanup_schedule_singleton" CHECK ("autograph_cleanup_schedule"."id" = 1),
	CONSTRAINT "autograph_cleanup_schedule_source" CHECK ("autograph_cleanup_schedule"."next_source" BETWEEN 0 AND 2)
);

--> statement-breakpoint
INSERT INTO autograph_cleanup_schedule(id, next_source) VALUES (1, 0);
