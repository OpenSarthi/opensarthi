from fastapi import APIRouter
from mcp.schemas import MCPTool, MCPCallToolRequest, MCPCallToolResponse

mcp_router = APIRouter(prefix="/mcp")

@mcp_router.get("/tools/list")
async def list_tools() -> dict:
    """Expose registered OpenSarthi tools as MCP tools."""
    from tools.registry import all_tools
    tools = [
        MCPTool(
            name=t.name,
            description=t.description,
            input_schema={"type": "object", "properties": {}}  # Standard schema placeholder
        )
        for t in all_tools()
    ]
    return {"tools": [t.model_dump() for t in tools]}

@mcp_router.post("/tools/call")
async def call_tool(request: MCPCallToolRequest) -> MCPCallToolResponse:
    """Execute an OpenSarthi tool via MCP."""
    from tools.registry import get
    tool = get(request.name)
    if tool is None:
        return MCPCallToolResponse(
            content=[{"type": "text", "text": f"Unknown tool: {request.name}"}],
            is_error=True
        )
    try:
        result = await tool.execute(request.arguments)
        return MCPCallToolResponse(
            content=[{"type": "text", "text": result.observation or result.error or "Completed with no output"}],
            is_error=not result.success
        )
    except Exception as e:
        return MCPCallToolResponse(
            content=[{"type": "text", "text": f"Execution error: {str(e)}"}],
            is_error=True
        )
