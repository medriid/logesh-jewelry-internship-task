CREATE TYPE "public"."actor_type" AS ENUM('ADMIN', 'API_KEY', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('READONLY', 'STAFF', 'MANAGER', 'OWNER');--> statement-breakpoint
CREATE TYPE "public"."admin_status" AS ENUM('ACTIVE', 'SUSPENDED', 'INVITED');--> statement-breakpoint
CREATE TYPE "public"."attribute_type" AS ENUM('TEXT', 'NUMBER', 'BOOLEAN', 'ENUM');--> statement-breakpoint
CREATE TYPE "public"."making_charge_type" AS ENUM('PER_GRAM', 'PERCENTAGE', 'FLAT');--> statement-breakpoint
CREATE TYPE "public"."metal" AS ENUM('GOLD', 'ROSE_GOLD', 'WHITE_GOLD', 'SILVER', 'PLATINUM');--> statement-breakpoint
CREATE TYPE "public"."occasion" AS ENUM('EVERYDAY', 'BRIDAL', 'FESTIVE', 'GIFTING', 'INVESTMENT');--> statement-breakpoint
CREATE TYPE "public"."pricing_mode" AS ENUM('FIXED', 'METAL_RATE');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."stock_reason" AS ENUM('INITIAL', 'RESTOCK', 'SALE', 'RESERVATION', 'RELEASE', 'RETURN', 'DAMAGE', 'CORRECTION');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'READONLY' NOT NULL,
	"status" "admin_status" DEFAULT 'INVITED' NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" text,
	"in_flight" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"image_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"occasion" "occasion" DEFAULT 'EVERYDAY' NOT NULL,
	"hero_image_url" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collections_window_ordered" CHECK ("collections"."ends_at" IS NULL OR "collections"."starts_at" IS NULL OR "collections"."ends_at" > "collections"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt_text" text NOT NULL,
	"width" integer,
	"height" integer,
	"placeholder" text,
	"content_hash" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"net_metal_weight_mg" integer,
	"gross_weight_mg" integer,
	"price_delta_paise" bigint DEFAULT 0 NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "product_variants_stock_non_negative" CHECK ("product_variants"."stock_quantity" >= 0),
	CONSTRAINT "product_variants_reserved_within_stock" CHECK ("product_variants"."reserved_quantity" <= "product_variants"."stock_quantity")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_description" text,
	"description" text,
	"category_id" uuid NOT NULL,
	"collection_id" uuid,
	"metal" "metal" DEFAULT 'GOLD' NOT NULL,
	"purity_karat" smallint DEFAULT 22 NOT NULL,
	"is_hallmarked" boolean DEFAULT true NOT NULL,
	"hallmark_number" text,
	"gross_weight_mg" integer DEFAULT 0 NOT NULL,
	"net_metal_weight_mg" integer DEFAULT 0 NOT NULL,
	"stone_weight_points" integer DEFAULT 0 NOT NULL,
	"pricing_mode" "pricing_mode" DEFAULT 'METAL_RATE' NOT NULL,
	"fixed_price_paise" bigint,
	"making_charge_type" "making_charge_type" DEFAULT 'PERCENTAGE' NOT NULL,
	"making_charge_value" bigint DEFAULT 0 NOT NULL,
	"wastage_basis_points" integer DEFAULT 0 NOT NULL,
	"stone_value_paise" bigint DEFAULT 0 NOT NULL,
	"tax_rate_basis_points" integer,
	"discount_basis_points" integer DEFAULT 0 NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 2 NOT NULL,
	"allow_backorder" boolean DEFAULT false NOT NULL,
	"status" "product_status" DEFAULT 'DRAFT' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(sku, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(short_description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_stock_non_negative" CHECK ("products"."stock_quantity" >= 0),
	CONSTRAINT "products_reserved_non_negative" CHECK ("products"."reserved_quantity" >= 0),
	CONSTRAINT "products_reserved_within_stock" CHECK ("products"."reserved_quantity" <= "products"."stock_quantity"),
	CONSTRAINT "products_weights_non_negative" CHECK ("products"."gross_weight_mg" >= 0 AND "products"."net_metal_weight_mg" >= 0 AND "products"."stone_weight_points" >= 0),
	CONSTRAINT "products_net_within_gross" CHECK ("products"."net_metal_weight_mg" <= "products"."gross_weight_mg"),
	CONSTRAINT "products_karat_valid" CHECK ("products"."purity_karat" IN (9, 14, 18, 22, 24)),
	CONSTRAINT "products_discount_range" CHECK ("products"."discount_basis_points" >= 0 AND "products"."discount_basis_points" <= 10000),
	CONSTRAINT "products_pricing_coherent" CHECK (("products"."pricing_mode" = 'FIXED' AND "products"."fixed_price_paise" IS NOT NULL AND "products"."fixed_price_paise" > 0)
       OR ("products"."pricing_mode" = 'METAL_RATE' AND "products"."net_metal_weight_mg" > 0))
);
--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"type" "attribute_type" DEFAULT 'TEXT' NOT NULL,
	"unit" text,
	"allowed_values" text[],
	"is_filterable" boolean DEFAULT false NOT NULL,
	"is_searchable" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_definitions_key_format" CHECK ("attribute_definitions"."key" ~ '^[a-z][a-z0-9_]{1,40}$'),
	CONSTRAINT "attribute_definitions_enum_has_values" CHECK ("attribute_definitions"."type" <> 'ENUM' OR ("attribute_definitions"."allowed_values" IS NOT NULL AND array_length("attribute_definitions"."allowed_values", 1) > 0))
);
--> statement-breakpoint
CREATE TABLE "product_attributes" (
	"product_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value_text" text,
	"value_number" integer,
	"value_boolean" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_attributes_product_id_attribute_id_pk" PRIMARY KEY("product_id","attribute_id"),
	CONSTRAINT "product_attributes_exactly_one_value" CHECK ((CASE WHEN "product_attributes"."value_text" IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN "product_attributes"."value_number" IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN "product_attributes"."value_boolean" IS NOT NULL THEN 1 ELSE 0 END) = 1)
);
--> statement-breakpoint
CREATE TABLE "metal_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metal" "metal" NOT NULL,
	"purity_karat" smallint NOT NULL,
	"rate_per_gram_paise" bigint NOT NULL,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metal_rates_positive" CHECK ("metal_rates"."rate_per_gram_paise" > 0),
	CONSTRAINT "metal_rates_karat_valid" CHECK ("metal_rates"."purity_karat" IN (9, 14, 18, 22, 24))
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" "stock_reason" NOT NULL,
	"reference" text,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_ledger_delta_nonzero" CHECK ("stock_ledger"."delta" <> 0),
	CONSTRAINT "stock_ledger_balance_non_negative" CHECK ("stock_ledger"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"actor_label" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"changes" jsonb,
	"ip_hash" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attribute_id_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metal_rates" ADD CONSTRAINT "metal_rates_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_actor_id_admin_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_lower_uq" ON "admin_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "admin_users_role_idx" ON "admin_users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_uq" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_keys_active_idx" ON "api_keys" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_uq" ON "collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "collections_window_idx" ON "collections" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_one_primary_uq" ON "product_images" USING btree ("product_id") WHERE is_primary = true;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_uq" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_one_default_uq" ON "product_variants" USING btree ("product_id") WHERE is_default = true AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_uq" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uq" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_live_idx" ON "products" USING btree ("status","created_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "products_collection_idx" ON "products" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "products_featured_idx" ON "products" USING btree ("is_featured") WHERE is_featured = true;--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_definitions_key_uq" ON "attribute_definitions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "product_attributes_attr_idx" ON "product_attributes" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "product_attributes_text_lookup_idx" ON "product_attributes" USING btree ("attribute_id","value_text");--> statement-breakpoint
CREATE INDEX "product_attributes_number_lookup_idx" ON "product_attributes" USING btree ("attribute_id","value_number");--> statement-breakpoint
CREATE UNIQUE INDEX "metal_rates_effective_uq" ON "metal_rates" USING btree ("metal","purity_karat","effective_from");--> statement-breakpoint
CREATE INDEX "metal_rates_lookup_idx" ON "metal_rates" USING btree ("metal","purity_karat","effective_from" DESC);--> statement-breakpoint
CREATE INDEX "stock_ledger_product_idx" ON "stock_ledger" USING btree ("product_id",created_at DESC);--> statement-breakpoint
CREATE INDEX "stock_ledger_variant_idx" ON "stock_ledger" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_reason_idx" ON "stock_ledger" USING btree ("reason");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id",created_at DESC);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id",created_at DESC);--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree (created_at DESC);