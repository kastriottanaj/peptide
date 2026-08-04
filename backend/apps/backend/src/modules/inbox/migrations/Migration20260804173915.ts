import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260804173915 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inbox_message" drop constraint if exists "inbox_message_mailbox_uid_unique";`);
    this.addSql(`alter table if exists "inbox_sync_state" drop constraint if exists "inbox_sync_state_mailbox_unique";`);
    this.addSql(`create table if not exists "inbox_sync_state" ("id" text not null, "mailbox" text not null, "uid_validity" text null, "last_uid" integer not null default 0, "initialized" boolean not null default false, "last_synced_at" timestamptz null, "last_success_at" timestamptz null, "last_status" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inbox_sync_state_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_inbox_sync_state_mailbox_unique" ON "inbox_sync_state" ("mailbox") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_sync_state_deleted_at" ON "inbox_sync_state" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "inbox_thread" ("id" text not null, "subject" text not null, "normalized_subject" text not null, "last_message_at" timestamptz not null, "message_count" integer not null default 0, "unread_count" integer not null default 0, "status" text check ("status" in ('open', 'resolved', 'spam')) not null default 'open', "last_sender_name" text null, "last_sender_email" text null, "search_text" text not null default '', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inbox_thread_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_thread_deleted_at" ON "inbox_thread" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_thread_last_message_at" ON "inbox_thread" ("last_message_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_thread_status_last_message_at" ON "inbox_thread" ("status", "last_message_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_thread_normalized_subject_last_message_at" ON "inbox_thread" ("normalized_subject", "last_message_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "inbox_message" ("id" text not null, "mailbox" text not null, "uid" integer not null, "message_id" text null, "in_reply_to" text null, "references" text null, "from_name" text null, "from_email" text null, "recipients" jsonb null, "subject" text not null, "received_at" timestamptz not null, "body_text" text not null default '', "body_truncated" boolean not null default false, "size_bytes" integer not null default 0, "attachments" jsonb null, "is_read" boolean not null default false, "thread_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inbox_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_message_thread_id" ON "inbox_message" ("thread_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_message_deleted_at" ON "inbox_message" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_inbox_message_mailbox_uid_unique" ON "inbox_message" ("mailbox", "uid") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_message_message_id" ON "inbox_message" ("message_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_message_in_reply_to" ON "inbox_message" ("in_reply_to") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbox_message_received_at" ON "inbox_message" ("received_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "inbox_message" add constraint "inbox_message_thread_id_foreign" foreign key ("thread_id") references "inbox_thread" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inbox_message" drop constraint if exists "inbox_message_thread_id_foreign";`);

    this.addSql(`drop table if exists "inbox_sync_state" cascade;`);

    this.addSql(`drop table if exists "inbox_thread" cascade;`);

    this.addSql(`drop table if exists "inbox_message" cascade;`);
  }

}
