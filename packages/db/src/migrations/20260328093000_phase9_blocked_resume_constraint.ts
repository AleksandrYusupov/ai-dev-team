import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table issue_runtime_state
      drop constraint if exists issue_runtime_state_pause_fields_chk;

    alter table issue_runtime_state
      add constraint issue_runtime_state_pause_fields_chk
      check (
        current_status_code in ('needs_input', 'needs_human_decision')
        or (
          current_status_code = 'blocked'
          and pause_reason_code is null
          and pause_reason_text is null
          and open_operator_question_id is null
        )
        or (
          pause_reason_code is null
          and pause_reason_text is null
          and resume_condition is null
          and open_operator_question_id is null
        )
      );
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table issue_runtime_state
      drop constraint if exists issue_runtime_state_pause_fields_chk;

    alter table issue_runtime_state
      add constraint issue_runtime_state_pause_fields_chk
      check (
        current_status_code in ('needs_input', 'needs_human_decision')
        or (
          pause_reason_code is null
          and pause_reason_text is null
          and resume_condition is null
          and open_operator_question_id is null
        )
      );
  `).execute(db)
}
