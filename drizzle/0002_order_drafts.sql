CREATE TABLE "order_draft_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "order_draft_items_quantity_range" CHECK ("order_draft_items"."quantity" between 1 and 9999)
);
--> statement-breakpoint
CREATE TABLE "order_drafts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_draft_items" ADD CONSTRAINT "order_draft_items_user_id_order_drafts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."order_drafts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_draft_items" ADD CONSTRAINT "order_draft_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_draft_items_user_product_idx" ON "order_draft_items" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "order_draft_items_user_position_idx" ON "order_draft_items" USING btree ("user_id","position");