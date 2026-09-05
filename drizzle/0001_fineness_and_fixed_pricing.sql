ALTER TABLE "products" DROP CONSTRAINT "products_karat_valid";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_pricing_coherent";--> statement-breakpoint
ALTER TABLE "metal_rates" DROP CONSTRAINT "metal_rates_karat_valid";--> statement-breakpoint
DROP INDEX "metal_rates_effective_uq";--> statement-breakpoint
DROP INDEX "metal_rates_lookup_idx";--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "metal" SET DEFAULT 'SILVER';--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "is_hallmarked" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "pricing_mode" SET DEFAULT 'FIXED';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "fineness_ppt" smallint DEFAULT 925 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "selling_price_paise" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "mrp_paise" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_inclusive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "metal_rates" ADD COLUMN "fineness_ppt" smallint NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "metal_rates_effective_uq" ON "metal_rates" USING btree ("metal","fineness_ppt","effective_from");--> statement-breakpoint
CREATE INDEX "metal_rates_lookup_idx" ON "metal_rates" USING btree ("metal","fineness_ppt","effective_from" DESC);--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "purity_karat";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "fixed_price_paise";--> statement-breakpoint
ALTER TABLE "metal_rates" DROP COLUMN "purity_karat";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_fineness_range" CHECK ("products"."fineness_ppt" > 0 AND "products"."fineness_ppt" <= 1000);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_rate_range" CHECK ("products"."tax_rate_basis_points" IS NULL OR ("products"."tax_rate_basis_points" >= 0 AND "products"."tax_rate_basis_points" <= 10000));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_mrp_above_selling" CHECK ("products"."mrp_paise" IS NULL OR "products"."selling_price_paise" IS NULL OR "products"."mrp_paise" > "products"."selling_price_paise");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_pricing_coherent" CHECK (("products"."pricing_mode" = 'FIXED' AND "products"."selling_price_paise" IS NOT NULL AND "products"."selling_price_paise" > 0)
       OR ("products"."pricing_mode" = 'METAL_RATE' AND "products"."net_metal_weight_mg" > 0));--> statement-breakpoint
ALTER TABLE "metal_rates" ADD CONSTRAINT "metal_rates_fineness_range" CHECK ("metal_rates"."fineness_ppt" > 0 AND "metal_rates"."fineness_ppt" <= 1000);