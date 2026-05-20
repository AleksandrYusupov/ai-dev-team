import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('bootstrap_markers')
    .ifNotExists()
    .addColumn('id', 'serial', (column) => column.primaryKey())
    .addColumn('name', 'varchar(255)', (column) => column.notNull().unique())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`current_timestamp`),
    )
    .execute()
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('bootstrap_markers').ifExists().execute()
}
