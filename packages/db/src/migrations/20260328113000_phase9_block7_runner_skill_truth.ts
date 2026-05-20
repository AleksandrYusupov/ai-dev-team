import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

const defaultIntegrationCapabilities = `
  '{"networkModesSupported":["docs_allowlist","sandbox_api_allowlist"],"allowedDocDomains":[],"allowedSandboxDomains":[],"supportsBrowserConsent":false,"supportsSecretBroker":false,"supportsOAuthBroker":false,"supportsIntegrationLab":false}'::jsonb
`

const runnerInventoryViewSql = `
  create view runner_inventory_view as
    select
      nodes.runner_node_id,
      nodes.host_group_id,
      nodes.display_name,
      nodes.host_name,
      nodes.status,
      coalesce(cap.providers, '[]'::jsonb) as providers,
      coalesce(cap.skills_available, '[]'::jsonb) as skills_available,
      nodes.current_active_lease_count,
      nodes.max_concurrent_leases,
      nodes.manifest_version,
      nodes.last_heartbeat_at,
      nodes.heartbeat_expires_at,
      coalesce(
        case
          when nodes.latest_mcp_pool_snapshot_at is null then null
          else (
            select count(*)
            from jsonb_array_elements(
              coalesce(
                nodes.latest_mcp_pool_snapshot_json->'bindings',
                nodes.latest_mcp_pool_snapshot_json->'activeBindings',
                nodes.latest_mcp_pool_snapshot_json->'active_bindings',
                nodes.latest_mcp_pool_snapshot_json->'mcpBindings',
                nodes.latest_mcp_pool_snapshot_json->'mcp_bindings',
                '[]'::jsonb
              )
            ) as entry
            where coalesce(entry->>'sharingScope', 'exclusive') <> 'exclusive'
              and coalesce(entry->>'processState', 'running') not in ('stopped', 'terminated')
          )
        end,
        (
          select count(*)
          from jsonb_array_elements(coalesce(cap.mcp_server_catalog, '[]'::jsonb)) as entry
          where coalesce(entry->>'sharingScope', 'exclusive') <> 'exclusive'
        ),
        0
      )::int as shared_mcp_process_count,
      coalesce(cap.mcp_server_catalog, '[]'::jsonb) as mcp_server_catalog,
      coalesce(cap.integration_capabilities_json, ${defaultIntegrationCapabilities}) as integration_capabilities_json
    from runner_nodes as nodes
    left join lateral (
      select *
      from runner_capabilities as capabilities
      where capabilities.runner_node_id = nodes.runner_node_id
        and capabilities.is_active = true
      order by capabilities.manifest_version desc
      limit 1
    ) as cap on true;
`

const providerFailoverMetricsViewSql = `
  create view provider_failover_metrics_view as
    with fallback_reason_counts as (
      select coalesce(
        jsonb_object_agg(fallback_reason, reason_count),
        '{}'::jsonb
      ) as fallback_reason_counts
      from (
        select
          fallback_reason,
          count(*)::int as reason_count
        from runner_lease_attempts
        where fallback_reason is not null
        group by fallback_reason
      ) as counts
    ),
    mcp_binding_stats as (
      select
        count(*)::numeric as total_bindings,
        count(*) filter (
          where coalesce((binding->>'reused')::boolean, false)
        )::numeric as reused_bindings
      from runner_lease_attempts
      cross join lateral jsonb_array_elements(
        coalesce(mcp_bindings_summary, '[]'::jsonb)
      ) as binding
    ),
    shared_process_counts as (
      select coalesce(sum(shared_mcp_process_count), 0)::int as shared_mcp_process_count
      from runner_inventory_view
    )
    select
      count(*)::int as total_leases,
      count(*) filter (where attempt_count > 1)::int as fallback_triggered_count,
      count(*) filter (where status = 'provider_fallback_exhausted')::int as provider_fallback_exhausted_count,
      (
        select count(*)::int
        from runner_lease_attempts
        where fallback_reason in ('quota_exhausted', 'rate_limited_exhausted')
      ) as provider_limit_exhaustion_events,
      (select fallback_reason_counts from fallback_reason_counts) as fallback_reason_counts,
      case
        when (select total_bindings from mcp_binding_stats) = 0 then null
        else round(
          (select reused_bindings from mcp_binding_stats)
          / nullif((select total_bindings from mcp_binding_stats), 0),
          4
        )::double precision
      end as mcp_pool_reuse_ratio,
      (select shared_mcp_process_count from shared_process_counts) as shared_mcp_process_count
    from runner_leases;
`

const previousRunnerInventoryViewSql = `
  create view runner_inventory_view as
    select
      nodes.runner_node_id,
      nodes.host_group_id,
      nodes.display_name,
      nodes.host_name,
      nodes.status,
      coalesce(cap.providers, '[]'::jsonb) as providers,
      nodes.current_active_lease_count,
      nodes.max_concurrent_leases,
      nodes.manifest_version,
      nodes.last_heartbeat_at,
      nodes.heartbeat_expires_at,
      coalesce(
        case
          when nodes.latest_mcp_pool_snapshot_at is null then null
          else (
            select count(*)
            from jsonb_array_elements(
              coalesce(
                nodes.latest_mcp_pool_snapshot_json->'bindings',
                nodes.latest_mcp_pool_snapshot_json->'activeBindings',
                nodes.latest_mcp_pool_snapshot_json->'active_bindings',
                nodes.latest_mcp_pool_snapshot_json->'mcpBindings',
                nodes.latest_mcp_pool_snapshot_json->'mcp_bindings',
                '[]'::jsonb
              )
            ) as entry
            where coalesce(entry->>'sharingScope', 'exclusive') <> 'exclusive'
              and coalesce(entry->>'processState', 'running') not in ('stopped', 'terminated')
          )
        end,
        (
          select count(*)
          from jsonb_array_elements(coalesce(cap.mcp_server_catalog, '[]'::jsonb)) as entry
          where coalesce(entry->>'sharingScope', 'exclusive') <> 'exclusive'
        ),
        0
      )::int as shared_mcp_process_count,
      coalesce(cap.mcp_server_catalog, '[]'::jsonb) as mcp_server_catalog,
      coalesce(cap.integration_capabilities_json, ${defaultIntegrationCapabilities}) as integration_capabilities_json
    from runner_nodes as nodes
    left join lateral (
      select *
      from runner_capabilities as capabilities
      where capabilities.runner_node_id = nodes.runner_node_id
        and capabilities.is_active = true
      order by capabilities.manifest_version desc
      limit 1
    ) as cap on true;
`

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table runner_capabilities
      add column skills_available jsonb not null default '[]'::jsonb;

    alter table runner_lease_attempts
      add column installed_skill_refs jsonb not null default '[]'::jsonb,
      add column resolved_skill_refs jsonb not null default '[]'::jsonb,
      add column skipped_optional_skill_refs jsonb not null default '[]'::jsonb;

    drop view if exists provider_failover_metrics_view;
    drop view if exists runner_inventory_view;
    ${runnerInventoryViewSql}
    ${providerFailoverMetricsViewSql}
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop view if exists provider_failover_metrics_view;
    drop view if exists runner_inventory_view;

    ${previousRunnerInventoryViewSql}
    ${providerFailoverMetricsViewSql}

    alter table runner_lease_attempts
      drop column if exists skipped_optional_skill_refs,
      drop column if exists resolved_skill_refs,
      drop column if exists installed_skill_refs;

    alter table runner_capabilities
      drop column if exists skills_available;
  `).execute(db)
}
