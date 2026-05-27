"""D38999 Chat Proxy — multi-backend HTTP server for the embedded AI chat.

Supports four model backends:
  - ollama    : Local Ollama server (default, no API key)
  - openai    : Any OpenAI-compatible API (OpenAI, Azure, LM Studio, Groq, Together)
  - github    : GitHub Models API (uses a GitHub PAT)
  - anthropic : Direct Anthropic Claude API

Usage:
    python scripts/serve_chat.py
    python scripts/serve_chat.py --port 8765
    python scripts/serve_chat.py --default-model qwen2.5
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from functools import partial
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ---------------------------------------------------------------------------
# Import shared tools from d38999_agent.py
# ---------------------------------------------------------------------------

sys.path.insert(0, str(Path(__file__).parent))
from d38999_agent import (
    SYSTEM_PROMPT,
    TOOLS,
    TOOL_DISPATCH,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_PORT = 8765
MAX_TOOL_ROUNDS = 8  # safety cap on agentic loops

# OpenAI-format tool schema (same for openai/github backends)
OPENAI_TOOLS = TOOLS  # already in OpenAI format from d38999_agent.py

# Anthropic tool format conversion
ANTHROPIC_TOOLS = []
for t in TOOLS:
    fn = t["function"]
    ANTHROPIC_TOOLS.append({
        "name": fn["name"],
        "description": fn["description"],
        "input_schema": fn["parameters"],
    })


# ---------------------------------------------------------------------------
# Backend adapters
# ---------------------------------------------------------------------------


def _post_json(url: str, body: dict, headers: dict) -> dict:
    """POST JSON and return parsed response."""
    data = json.dumps(body).encode()
    req = Request(url, data=data, headers={**headers, "Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def _execute_tools(tool_calls_raw: list[dict]) -> list[dict]:
    """Run tool calls and return tool-role messages."""
    results = []
    for call in tool_calls_raw:
        name = call.get("name") or call.get("function", {}).get("name", "")
        args = call.get("arguments") or call.get("input") or call.get("function", {}).get("arguments") or {}
        if isinstance(args, str):
            args = json.loads(args)
        call_id = call.get("id", f"call_{name}")

        if name in TOOL_DISPATCH:
            result = TOOL_DISPATCH[name](args)
        else:
            result = {"error": f"Unknown tool: {name}"}

        results.append({
            "role": "tool",
            "tool_call_id": call_id,
            "content": json.dumps(result, ensure_ascii=False),
        })
    return results


# --- Ollama adapter ---

OLLAMA_BASE = "http://localhost:11434"


def _ollama_chat_rest(model: str, messages: list[dict], tools: list | None = None) -> dict:
    """Call Ollama's native REST API directly (no Python package required)."""
    body: dict = {"model": model, "messages": messages, "stream": False}
    if tools:
        body["tools"] = tools
    url = f"{OLLAMA_BASE}/api/chat"
    data = json.dumps(body).encode()
    req = __import__("urllib.request", fromlist=["Request", "urlopen"]).Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    from urllib.request import urlopen as _urlopen
    with _urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def chat_ollama(messages: list[dict], model: str, **_kwargs) -> dict:
    """Chat via local Ollama server (uses REST API directly; Python package optional)."""
    use_package = False
    try:
        import ollama as ollama_pkg  # noqa: F401
        use_package = True
    except ImportError:
        pass  # fall back to direct REST call

    conversation = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

    for _ in range(MAX_TOOL_ROUNDS):
        if use_package:
            import ollama as ollama_pkg
            response = ollama_pkg.chat(model=model, messages=conversation, tools=OPENAI_TOOLS)
            msg = response.message
            content = msg.content or ""
            tool_calls_raw = msg.tool_calls or []
            # Normalise to dicts
            tool_calls = [
                {"id": f"call_{i}", "name": tc.function.name,
                 "arguments": tc.function.arguments or {}}
                for i, tc in enumerate(tool_calls_raw)
            ]
        else:
            raw = _ollama_chat_rest(model, conversation, tools=OPENAI_TOOLS)
            msg = raw.get("message", {})
            content = msg.get("content", "") or ""
            tool_calls = msg.get("tool_calls") or []

        if not tool_calls:
            return {"role": "assistant", "content": content}

        # Record assistant turn
        conversation.append({
            "role": "assistant",
            "content": content,
            "tool_calls": [
                {"id": tc.get("id", f"call_{i}"),
                 "function": {"name": tc.get("name") or tc.get("function", {}).get("name", ""),
                              "arguments": json.dumps(tc.get("arguments") or tc.get("function", {}).get("arguments") or {})}}
                for i, tc in enumerate(tool_calls)
            ],
        })

        # Execute tools
        for i, tc in enumerate(tool_calls):
            name = tc.get("name") or tc.get("function", {}).get("name", "")
            args = tc.get("arguments") or tc.get("function", {}).get("arguments") or {}
            if isinstance(args, str):
                args = json.loads(args)
            result = TOOL_DISPATCH.get(name, lambda a: {"error": f"Unknown tool: {name}"})(args)
            conversation.append({
                "role": "tool",
                "tool_call_id": tc.get("id", f"call_{i}"),
                "content": json.dumps(result, ensure_ascii=False),
            })

    return {"role": "assistant", "content": content or "(max tool rounds reached)"}


# --- OpenAI-compatible adapter ---

def chat_openai(messages: list[dict], model: str, api_key: str = "", base_url: str = "https://api.openai.com/v1", use_tools: bool = True, **_kwargs) -> dict:
    """Chat via any OpenAI-compatible API."""
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    conversation = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

    for _ in range(MAX_TOOL_ROUNDS):
        body = {"model": model, "messages": conversation}
        if use_tools:
            body["tools"] = OPENAI_TOOLS
        resp = _post_json(url, body, headers)

        choice = resp.get("choices", [{}])[0]
        msg = choice.get("message", {})
        content = msg.get("content", "") or ""
        tool_calls = msg.get("tool_calls") or []

        if not tool_calls:
            return {"role": "assistant", "content": content}

        conversation.append(msg)

        for tc in tool_calls:
            fn = tc.get("function", {})
            name = fn.get("name", "")
            args = json.loads(fn.get("arguments", "{}"))
            result = TOOL_DISPATCH.get(name, lambda a: {"error": f"Unknown tool: {name}"})(args)
            conversation.append({
                "role": "tool",
                "tool_call_id": tc.get("id", ""),
                "content": json.dumps(result, ensure_ascii=False),
            })

    return {"role": "assistant", "content": content or "(max tool rounds reached)"}


# --- GitHub Models adapter ---

# Models confirmed to support tool-calling via the catalog API
_GITHUB_TOOL_CAPABLE = {
    "ai21-labs/ai21-jamba-1.5-large",
    "cohere/cohere-command-r-plus-08-2024",
    "deepseek/deepseek-r1",
    "deepseek/deepseek-r1-0528",
    "deepseek/deepseek-v3-0324",
    "meta/llama-4-maverick-17b-128e-instruct-fp8",
    "meta/llama-4-scout-17b-16e-instruct",
    "mistral-ai/ministral-3b",
    "mistral-ai/mistral-medium-2505",
    "mistral-ai/mistral-small-2503",
    "openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4.1-nano",
    "openai/gpt-4o", "openai/gpt-4o-mini",
    "openai/gpt-5", "openai/gpt-5-chat", "openai/gpt-5-mini", "openai/gpt-5-nano",
    "openai/o1", "openai/o3", "openai/o3-mini", "openai/o4-mini",
}

def chat_github(messages: list[dict], model: str, api_key: str = "", **_kwargs) -> dict:
    """Chat via GitHub Models API, with automatic history trimming on token overflow."""
    base_url = "https://models.github.ai/inference"
    use_tools = model in _GITHUB_TOOL_CAPABLE
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    # Try with progressively shorter history if the model overflows
    for keep in (len(messages), 6, 4, 2, 0):
        trimmed = messages[-keep:] if keep else []
        # Ensure first kept message is from user (not mid-conversation assistant turn)
        while trimmed and trimmed[0]["role"] != "user":
            trimmed = trimmed[1:]
        conversation = [{"role": "system", "content": SYSTEM_PROMPT}] + trimmed

        for _ in range(MAX_TOOL_ROUNDS):
            body = {"model": model, "messages": conversation}
            if use_tools:
                body["tools"] = OPENAI_TOOLS
            try:
                resp = _post_json(url, body, headers)
            except HTTPError as e:
                error_body = e.read().decode() if hasattr(e, "read") else str(e)
                try:
                    err_json = json.loads(error_body)
                    code = (err_json.get("error") or {}).get("code", "")
                except Exception:
                    code = ""
                if code == "tokens_limit_reached" and keep > 0:
                    break  # retry with shorter history
                raise  # re-raise other errors

            choice = resp.get("choices", [{}])[0]
            msg = choice.get("message", {})
            content = msg.get("content", "") or ""
            tool_calls = msg.get("tool_calls") or []

            if not tool_calls:
                note = f"\n\n*(Note: conversation trimmed to last {keep} messages to fit this model's context window.)*" if keep < len(messages) else ""
                return {"role": "assistant", "content": content + note}

            conversation.append(msg)
            for tc in tool_calls:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                args = json.loads(fn.get("arguments", "{}"))
                result = TOOL_DISPATCH.get(name, lambda a: {"error": f"Unknown tool: {name}"})(args)
                conversation.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": json.dumps(result, ensure_ascii=False),
                })
        else:
            return {"role": "assistant", "content": "(max tool rounds reached)"}

    return {"role": "assistant", "content": "Conversation is too long for this model's context window. Please start a new chat."}


# --- Gemini adapter ---

def chat_gemini(messages: list[dict], model: str, api_key: str = "", **_kwargs) -> dict:
    """Chat via Google Gemini API (OpenAI-compatible endpoint)."""
    base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
    return chat_openai(messages, model=model, api_key=api_key, base_url=base_url)


# --- Anthropic adapter ---

def chat_anthropic(messages: list[dict], model: str, api_key: str = "", **_kwargs) -> dict:
    """Chat via Anthropic Messages API with tool_use."""
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }

    # Convert messages to Anthropic format (no system in messages array)
    anthropic_messages = []
    for m in messages:
        role = m.get("role", "user")
        if role == "system":
            continue
        anthropic_messages.append({"role": role, "content": m.get("content", "")})

    for _ in range(MAX_TOOL_ROUNDS):
        body = {
            "model": model,
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "messages": anthropic_messages,
            "tools": ANTHROPIC_TOOLS,
        }
        resp = _post_json(url, body, headers)

        content_blocks = resp.get("content", [])
        stop_reason = resp.get("stop_reason", "end_turn")

        # Extract text and tool_use blocks
        text_parts = []
        tool_uses = []
        for block in content_blocks:
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                tool_uses.append(block)

        if not tool_uses or stop_reason != "tool_use":
            return {"role": "assistant", "content": "\n".join(text_parts)}

        # Record assistant turn
        anthropic_messages.append({"role": "assistant", "content": content_blocks})

        # Execute tools and add results
        tool_results = []
        for tu in tool_uses:
            name = tu.get("name", "")
            args = tu.get("input", {})
            result = TOOL_DISPATCH.get(name, lambda a: {"error": f"Unknown tool: {name}"})(args)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tu.get("id", ""),
                "content": json.dumps(result, ensure_ascii=False),
            })

        anthropic_messages.append({"role": "user", "content": tool_results})

    return {"role": "assistant", "content": "\n".join(text_parts) or "(max tool rounds reached)"}


# ---------------------------------------------------------------------------
# Backend dispatcher
# ---------------------------------------------------------------------------

BACKENDS = {
    "ollama": chat_ollama,
    "openai": chat_openai,
    "github": chat_github,
    "gemini": chat_gemini,
    "anthropic": chat_anthropic,
}

DEFAULT_MODELS = {
    "ollama": "gemma4",
    "openai": "gpt-4o-mini",
    "github": "openai/gpt-4o",
    "gemini": "gemini-2.5-flash",
    "anthropic": "claude-sonnet-4-20250514",
}


# ---------------------------------------------------------------------------
# HTTP Server
# ---------------------------------------------------------------------------


class ChatHandler(BaseHTTPRequestHandler):
    default_model: str = "gemma4"

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _json_response(self, status: int, data: Any):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/health":
            backends_status = {"ollama": False, "openai": True, "github": True, "gemini": True, "anthropic": True}
            try:
                import ollama as ollama_pkg
                ollama_pkg.list()
                backends_status["ollama"] = True
            except Exception:
                pass
            self._json_response(200, {
                "status": "ok",
                "backends": backends_status,
                "default_models": DEFAULT_MODELS,
            })
        elif self.path == "/api/models":
            models: dict[str, list[str]] = {
                "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano"],
                "github": [
                    "openai/gpt-4o", "openai/gpt-4o-mini",
                    "openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4.1-nano",
                    "openai/gpt-5", "openai/gpt-5-chat", "openai/gpt-5-mini", "openai/gpt-5-nano",
                    "openai/o1", "openai/o1-mini", "openai/o1-preview",
                    "openai/o3", "openai/o3-mini", "openai/o4-mini",
                    "xai/grok-3", "xai/grok-3-mini",
                    "deepseek/deepseek-r1", "deepseek/deepseek-r1-0528", "deepseek/deepseek-v3-0324",
                    "microsoft/mai-ds-r1",
                    "microsoft/phi-4", "microsoft/phi-4-mini-instruct", "microsoft/phi-4-mini-reasoning",
                    "microsoft/phi-4-multimodal-instruct", "microsoft/phi-4-reasoning",
                    "meta/meta-llama-3.1-405b-instruct", "meta/meta-llama-3.1-8b-instruct",
                    "meta/llama-3.2-11b-vision-instruct", "meta/llama-3.2-90b-vision-instruct",
                    "meta/llama-3.3-70b-instruct",
                    "meta/llama-4-maverick-17b-128e-instruct-fp8", "meta/llama-4-scout-17b-16e-instruct",
                    "mistral-ai/mistral-medium-2505", "mistral-ai/mistral-small-2503",
                    "mistral-ai/codestral-2501", "mistral-ai/ministral-3b",
                    "cohere/cohere-command-a",
                    "cohere/cohere-command-r-plus-08-2024", "cohere/cohere-command-r-08-2024",
                    "ai21-labs/ai21-jamba-1.5-large",
                ],
                "gemini": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
                "anthropic": ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"],
            }
            try:
                import ollama as ollama_pkg
                available = ollama_pkg.list()
                models["ollama"] = [m.model for m in available.models]
            except Exception:
                models["ollama"] = []
            self._json_response(200, models)
        else:
            self._json_response(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/api/chat":
            self._json_response(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length)
        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            self._json_response(400, {"error": "Invalid JSON"})
            return

        messages = req.get("messages", [])
        provider = req.get("provider", "ollama")
        model = req.get("model", "") or DEFAULT_MODELS.get(provider, self.default_model)
        api_key = req.get("apiKey", "")
        base_url = req.get("baseUrl", "")

        if provider not in BACKENDS:
            self._json_response(400, {"error": f"Unknown provider: {provider}. Use: {', '.join(BACKENDS.keys())}"})
            return

        if not messages:
            self._json_response(400, {"error": "messages array is required"})
            return

        try:
            kwargs: dict[str, Any] = {"messages": messages, "model": model}
            if api_key:
                kwargs["api_key"] = api_key
            if base_url:
                kwargs["base_url"] = base_url

            result = BACKENDS[provider](**kwargs)
            self._json_response(200, result)
        except HTTPError as e:
            error_body = e.read().decode() if hasattr(e, "read") else str(e)
            self._json_response(e.code, {"error": f"{provider} API error: {error_body}"})
        except URLError as e:
            self._json_response(502, {"error": f"Cannot reach {provider}: {e.reason}"})
        except Exception as e:
            traceback.print_exc()
            self._json_response(500, {"error": str(e)})

    def log_message(self, format, *args):
        # Quieter logging
        sys.stderr.write(f"[chat] {args[0]}\n" if args else "")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port (default: {DEFAULT_PORT})")
    parser.add_argument("--default-model", default="llama3.1", help="Default Ollama model")
    args = parser.parse_args()

    ChatHandler.default_model = args.default_model
    server = HTTPServer(("127.0.0.1", args.port), ChatHandler)
    print(f"D38999 Chat Proxy running on http://127.0.0.1:{args.port}")
    print(f"  POST /api/chat    — send messages")
    print(f"  GET  /api/health  — check backend status")
    print(f"  GET  /api/models  — list available models")
    print(f"\nBackends: ollama, openai, github, anthropic")
    print(f"Default model: {args.default_model}")
    print("Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
