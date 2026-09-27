import sys
import json
import asyncio
from paper_search_mcp.server import mcp

async def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "tool_name and arguments json required"}))
        return

    tool_name = sys.argv[1]
    args = json.loads(sys.argv[2])

    try:
        res = await mcp.call_tool(tool_name, args)
        if isinstance(res, tuple) and len(res) > 0:
            content_list = res[0]
            texts = [c.text for c in content_list if hasattr(c, "text")]
            print(json.dumps({"success": True, "data": "\n".join(texts)}))
        else:
            print(json.dumps({"success": True, "data": str(res)}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    asyncio.run(main())
