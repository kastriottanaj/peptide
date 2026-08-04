import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260804215307 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inbox_message" drop constraint if exists "inbox_message_idempotency_key_unique";`);
    this.addSql(`alter table if exists "inbox_message" add column if not exists "direction" text check ("direction" in ('inbound', 'outbound')) not null default 'inbound', add column if not exists "reply_to" text null, add column if not exists "delivery_status" text check ("delivery_status" in ('pending', 'sent', 'failed')) null, add column if not exists "sent_at" timestamptz null, add column if not exists "failure_reason" text null, add column if not exists "idempotency_key" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_message_direction_created_at" ON "inbox_message" ("direction", "created_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_inbox_message_idempotency_key_unique" ON "inbox_message" ("idempotency_key") WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_inbox_message_direction_created_at";`);
    this.addSql(`drop index if exists "IDX_inbox_message_idempotency_key_unique";`);
    this.addSql(`alter table if exists "inbox_message" drop column if exists "direction", drop column if exists "reply_to", drop column if exists "delivery_status", drop column if exists "sent_at", drop column if exists "failure_reason", drop column if exists "idempotency_key";`);
  }

}
