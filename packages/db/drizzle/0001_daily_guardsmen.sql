CREATE TABLE "analysis_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"approval_type" varchar(40) DEFAULT 'EXECUTION_APPROVAL' NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"requested_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_payload_json" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "analysis_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_id" uuid,
	"artifact_kind" varchar(32) NOT NULL,
	"artifact_name" varchar(120) NOT NULL,
	"mime_type" varchar(80) DEFAULT 'application/json' NOT NULL,
	"payload_json" jsonb,
	"storage_uri" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_mode" varchar(20) NOT NULL,
	"status" varchar(24) DEFAULT 'QUEUED' NOT NULL,
	"current_stage_key" varchar(32),
	"complexity_score" numeric(8, 2),
	"upgrade_reason" varchar(255),
	"parent_chat_session_id" uuid,
	"input_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shared_context_json" jsonb,
	"decision_object_json" jsonb,
	"final_report_markdown" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analysis_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_key" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"checkpoint_version" integer DEFAULT 0 NOT NULL,
	"parallel_group_key" varchar(40),
	"structured_output_json" jsonb,
	"human_report_markdown" text,
	"error_json" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watchlist_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"category_key" varchar(100) NOT NULL,
	"description" varchar(255),
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"company_name" varchar(200),
	"thesis" text,
	"notes" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_approvals" ADD CONSTRAINT "analysis_approvals_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_approvals" ADD CONSTRAINT "analysis_approvals_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_artifacts" ADD CONSTRAINT "analysis_artifacts_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_artifacts" ADD CONSTRAINT "analysis_artifacts_stage_id_analysis_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."analysis_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_stages" ADD CONSTRAINT "analysis_stages_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_categories" ADD CONSTRAINT "watchlist_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_category_id_watchlist_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."watchlist_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analysis_approvals_run_status" ON "analysis_approvals" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "idx_analysis_artifacts_run_kind" ON "analysis_artifacts" USING btree ("run_id","artifact_kind");--> statement-breakpoint
CREATE INDEX "idx_analysis_artifacts_stage" ON "analysis_artifacts" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "idx_analysis_runs_user_created" ON "analysis_runs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_analysis_runs_user_status" ON "analysis_runs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_analysis_runs_parent_chat_session" ON "analysis_runs" USING btree ("parent_chat_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_analysis_stages_run_stage_key" ON "analysis_stages" USING btree ("run_id","stage_key");--> statement-breakpoint
CREATE INDEX "idx_analysis_stages_run_status" ON "analysis_stages" USING btree ("run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_watchlist_categories_user_key" ON "watchlist_categories" USING btree ("user_id","category_key");--> statement-breakpoint
CREATE INDEX "idx_watchlist_categories_user_id" ON "watchlist_categories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_watchlist_items_category_symbol" ON "watchlist_items" USING btree ("category_id","symbol");--> statement-breakpoint
CREATE INDEX "idx_watchlist_items_user_id" ON "watchlist_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_watchlist_items_category_id" ON "watchlist_items" USING btree ("category_id");