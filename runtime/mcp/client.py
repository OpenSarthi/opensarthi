import httpx
from typing import List
from mcp.schemas import MCPTool, MCPCallToolResponse

class MCPClient:
    """
    Connect to an external Model Context Protocol (MCP) server.
    Exposes APIs to list and call external tools.
    """

    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def list_tools(self) -> List[MCPTool]:
        """Query external server for its list of tools."""
        try:
            resp = await self._client.get(f"{self.server_url}/tools/list")
            resp.raise_for_status()
            tools_data = resp.json().get("tools", [])
            return [MCPTool(**t) for t in tools_data]
        except Exception:
            return []

    async def call_tool(self, name: str, arguments: dict) -> MCPCallToolResponse:
        """Call a specific tool on the external server."""
        try:
            resp = await self._client.post(
                f"{self.server_url}/tools/call",
                json={"name": name, "arguments": arguments}
            )
            resp.raise_for_status()
            return MCPCallToolResponse(**resp.json())
        except Exception as e:
            return MCPCallToolResponse(
                content=[{"type": "text", "text": f"External MCP call failed: {str(e)}"}],
                is_error=True
            )

    async def close(self):
        """Close connection client."""
        await self._client.aclose()
