import os
from typing import Any, Dict, Tuple

from fastmcp import FastMCP
from supabase import create_client, Client


mcp = FastMCP("swarm-core-state")


def _get_env_config() -> Tuple[str, str, str]:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    swarm_core_id = os.getenv("SWARM_CORE_ID")

    missing = [
        name
        for name, value in [
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_KEY", supabase_key),
            ("SWARM_CORE_ID", swarm_core_id),
        ]
        if not value
    ]

    if missing:
        raise ValueError(f"Missing required env: {', '.join(missing)}")

    return supabase_url, supabase_key, swarm_core_id


def _update_state(state: str) -> Dict[str, Any]:
    try:
        supabase_url, supabase_key, swarm_core_id = _get_env_config()
        supabase: Client = create_client(supabase_url, supabase_key)
        response = (
            supabase.table("swarm_cores")
            .update({"state": state})
            .eq("id", swarm_core_id)
            .execute()
        )
        row_count = len(response.data) if getattr(response, "data", None) else 0
        return {
            "ok": True,
            "state": state,
            "swarm_core_id": swarm_core_id,
            "row_count": row_count,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@mcp.tool
def set_state(state: str) -> Dict[str, Any]:
    """Set an arbitrary swarm_cores.state value for the configured SWARM_CORE_ID."""
    return _update_state(state)


@mcp.tool
def set_thinking() -> Dict[str, Any]:
    """Set swarm_cores.state to \"thinking\" for the configured SWARM_CORE_ID."""
    return _update_state("thinking")


@mcp.tool
def set_working() -> Dict[str, Any]:
    """Set swarm_cores.state to \"working\" for the configured SWARM_CORE_ID."""
    return _update_state("working")


@mcp.tool
def set_flexing() -> Dict[str, Any]:
    """Set swarm_cores.state to \"flexing\" for the configured SWARM_CORE_ID."""
    return _update_state("flexing")


if __name__ == "__main__":
    mcp.run()
