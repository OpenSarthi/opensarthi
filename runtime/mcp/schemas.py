from pydantic import BaseModel
from typing import Any, Optional, Dict, List

class MCPTool(BaseModel):
    name: str
    description: str
    input_schema: Dict[str, Any]  # JSON Schema

class MCPCallToolRequest(BaseModel):
    name: str
    arguments: Dict[str, Any] = {}

class MCPCallToolResponse(BaseModel):
    content: List[Dict[str, Any]]
    is_error: bool = False
