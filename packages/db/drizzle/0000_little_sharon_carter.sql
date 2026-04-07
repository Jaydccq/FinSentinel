CREATE TABLE "agent_brains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"frontal_lobe" text DEFAULT '' NOT NULL,
	"emotion" varchar(20) DEFAULT 'neutral' NOT NULL,
	"commit_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_brains_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq_no" bigint GENERATED ALWAYS AS IDENTITY (sequence name "agent_events_seq_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"aggregate_type" varchar(50) NOT NULL,
	"aggregate_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_events_seq_no_unique" UNIQUE("seq_no")
);
--> statement-breakpoint
CREATE TABLE "agent_heartbeat_configs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_seconds" integer DEFAULT 600 NOT NULL,
	"drawdown_alert_pct" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"last_beat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"cron_expression" varchar(120) NOT NULL,
	"task_type" varchar(50) NOT NULL,
	"task_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_name" varchar(64) NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_session_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"summary_text" text DEFAULT '' NOT NULL,
	"compacted_message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunk_entity_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"mention_text" varchar(500) NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta_title" text,
	"meta_source" text,
	"meta_entities" text,
	"search_vector" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"original_file_name" varchar(255) NOT NULL,
	"doc_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"sector" varchar(255),
	"region_id" varchar(10) DEFAULT 'US',
	"user_id" uuid,
	"file_size" bigint,
	"chunk_count" integer,
	"storage_key" varchar(255),
	"storage_tier" varchar(50) DEFAULT 'HOT' NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"company_name" varchar(200),
	"quantity" numeric(15, 6) NOT NULL,
	"average_cost" numeric(15, 2) NOT NULL,
	"current_price" numeric(15, 2),
	"sector" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"relation_type" varchar(50) NOT NULL,
	"confidence" real NOT NULL,
	"evidence" text,
	"source_chunk_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" varchar(200) NOT NULL,
	"source" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"summary" text,
	"article_url" varchar(255),
	"author" varchar(255),
	"published_at" timestamp with time zone NOT NULL,
	"tickers" jsonb,
	"tags" jsonb,
	"sentiment" varchar(255),
	"enriched" boolean DEFAULT false NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(255),
	"user_id" uuid NOT NULL,
	"total_value" numeric(15, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"risk_score" integer NOT NULL,
	"risk_level" varchar(50) NOT NULL,
	"summary" text,
	"factors_json" jsonb,
	"advice_json" jsonb,
	"disclaimer" text,
	"regulatory_framework" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"initial_capital" numeric(15, 2) DEFAULT '100000.00' NOT NULL,
	"cash_balance" numeric(15, 2) DEFAULT '100000.00' NOT NULL,
	"trading_mode" varchar(10) DEFAULT 'PAPER' NOT NULL,
	"positions" jsonb DEFAULT '[]'::jsonb,
	"commit_history" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trade_wallets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_investment_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"working_memory" text,
	"risk_tolerance" varchar(20),
	"investment_horizon" varchar(20),
	"current_sentiment" varchar(30),
	"sentiment_reason" text,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"state_history" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_investment_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(50) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"display_name" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_brains" ADD CONSTRAINT "agent_brains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_heartbeat_configs" ADD CONSTRAINT "agent_heartbeat_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedules" ADD CONSTRAINT "agent_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_memories" ADD CONSTRAINT "chat_session_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reports" ADD CONSTRAINT "risk_reports_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_wallets" ADD CONSTRAINT "trade_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_investment_profiles" ADD CONSTRAINT "user_investment_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_brains_user_id" ON "agent_brains" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_agent_events_user_seq" ON "agent_events" USING btree ("user_id","seq_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agent_events_user_created" ON "agent_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agent_events_aggregate" ON "agent_events" USING btree ("aggregate_type","aggregate_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_events_user_idempotency_key" ON "agent_events" USING btree ("user_id","idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_agent_heartbeat_enabled_last_beat" ON "agent_heartbeat_configs" USING btree ("enabled","last_beat_at");--> statement-breakpoint
CREATE INDEX "idx_agent_schedules_user_created" ON "agent_schedules" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agent_schedules_enabled_next_run" ON "agent_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_user_id_key_name_unique" ON "api_keys" USING btree ("user_id","key_name");--> statement-breakpoint
CREATE INDEX "idx_api_keys_user" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_user_id" ON "chat_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_session_id" ON "chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_chat_session_memory_user_session" ON "chat_session_memories" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "idx_chat_session_memories_user_session" ON "chat_session_memories" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_chunk_entity_links" ON "chunk_entity_links" USING btree ("entity_id","chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_document_chunks_source_chunk" ON "document_chunks" USING btree ("source_type","source_id","chunk_index");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_source" ON "document_chunks" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_fts" ON "document_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_documents_user_id" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_holdings_portfolio_id" ON "holdings" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_entities_name" ON "knowledge_entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_knowledge_entities_type" ON "knowledge_entities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_knowledge_relations_source" ON "knowledge_relations" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_relations_target" ON "knowledge_relations" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_relations_type" ON "knowledge_relations" USING btree ("relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_news_source_source_id" ON "news_items" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "idx_news_published_at" ON "news_items" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_news_enriched" ON "news_items" USING btree ("enriched");--> statement-breakpoint
CREATE INDEX "idx_portfolios_user_id" ON "portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_risk_reports_portfolio_id" ON "risk_reports" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "idx_trade_wallets_user_id" ON "trade_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_investment_profiles_user_id" ON "user_investment_profiles" USING btree ("user_id");