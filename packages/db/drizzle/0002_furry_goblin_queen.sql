CREATE TABLE "context_journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"run_id" uuid,
	"stage_key" varchar(32),
	"role_key" varchar(64),
	"entry_type" varchar(40) NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_ref" varchar(255),
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context_journal_entries" ADD CONSTRAINT "context_journal_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_journal_entries" ADD CONSTRAINT "context_journal_entries_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_context_journal_run_created" ON "context_journal_entries" USING btree ("run_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_context_journal_session_created" ON "context_journal_entries" USING btree ("session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_context_journal_stage_created" ON "context_journal_entries" USING btree ("stage_key","created_at" DESC NULLS LAST);