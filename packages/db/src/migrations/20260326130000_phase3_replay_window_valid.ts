import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table raw_event_inbox
      add column if not exists replay_window_valid boolean null;
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table raw_event_inbox
      drop column if exists replay_window_valid;
  `).execute(db)
}
