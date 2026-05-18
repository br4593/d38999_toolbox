"""D38999 AI Agent — runs locally via Ollama, no API key required.

Setup (one-time):
    # 1. Install Ollama: https://ollama.com/download
    # 2. Pull a model:
    #        ollama pull llama3.1          # 8B, good balance
    #        ollama pull qwen2.5           # alternative
    # 3. Install the Python package:
    #        pip install ollama
    # 4. Run this agent:
    #        python scripts/d38999_agent.py
    #        python scripts/d38999_agent.py --model qwen2.5
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Data paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"


def _load_json(name: str) -> Any:
    with open(DATA_DIR / name) as f:
        return json.load(f)


# Lazy-loaded once at first use
_insert_arrangements: list[dict] | None = None
_dla_documents: list[dict] | None = None
_standard_definitions: dict | None = None


def _get_arrangements() -> list[dict]:
    global _insert_arrangements
    if _insert_arrangements is None:
        _insert_arrangements = _load_json("insert_arrangements.json")["arrangements"]
    return _insert_arrangements


def _get_documents() -> list[dict]:
    global _dla_documents
    if _dla_documents is None:
        _dla_documents = _load_json("dla_documents.json")["documents"]
    return _dla_documents


def _get_definitions() -> dict:
    global _standard_definitions
    if _standard_definitions is None:
        _standard_definitions = _load_json("standard_definitions.json")["definitions"]
    return _standard_definitions


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

sys.path.insert(0, str(Path(__file__).parent))
from d38999_rules import convert_pin, MIL_SHELL_TYPES, CONTACT_DESCRIPTIONS, RULES


def tool_decode_part_number(part_number: str) -> dict:
    """Decode and convert a MIL-DTL-38999 part number."""
    try:
        result = convert_pin(part_number, include_unsupported=False)
        # Strip SVG/heavy fields from any nested data
        return result
    except ValueError as exc:
        return {"error": str(exc), "part_number": part_number}


def tool_lookup_insert_arrangement(arrangement_id: str) -> dict:
    """Look up an insert arrangement by id (e.g. '22-55' or '20-9').
    Returns contact count, service rating, shell size, and notes.
    """
    arrangements = _get_arrangements()
    # Normalize: strip leading zeros from arrangement number
    parts = arrangement_id.split("-")
    if len(parts) == 2:
        normalized = f"{parts[0]}-{parts[1].lstrip('0') or '0'}"
    else:
        normalized = arrangement_id

    for arr in arrangements:
        if arr["id"] == normalized or arr["id"] == arrangement_id:
            return {
                "id": arr["id"],
                "shell_size": arr.get("shell_size"),
                "shell_size_code": arr.get("shell_size_code"),
                "arrangement_number": arr.get("arrangement_number"),
                "contact_count": arr.get("contact_count"),
                "service_rating": arr.get("service_rating"),
                "contact_size_notes": arr.get("contact_size_notes"),
                "notes": arr.get("notes"),
                "confidence": arr.get("confidence"),
                "source_page": arr.get("source_page"),
            }
    return {"error": f"Arrangement '{arrangement_id}' not found.", "hint": "IDs are in format shell_size-arrangement_number, e.g. '22-55'"}


def tool_search_dla_documents(query: str) -> list[dict]:
    """Search DLA documents by slash_sheet number, series, family, or keyword.
    Returns matching document metadata (title, description, date, url).
    """
    docs = _get_documents()
    q = query.lower().strip()
    results = []
    for doc in docs:
        searchable = " ".join(str(v) for v in doc.values() if v).lower()
        if q in searchable:
            results.append({
                "title": doc.get("title"),
                "slash_sheet": doc.get("slash_sheet"),
                "series": doc.get("series"),
                "family": doc.get("family"),
                "description": doc.get("description"),
                "date": doc.get("date"),
                "contacts": doc.get("contacts"),
                "url": doc.get("url"),
            })
    return results[:10]  # cap at 10


def tool_list_manufacturers(series: str | None = None) -> list[dict]:
    """List available manufacturer conversion rules, optionally filtered by series ('III' or 'IV')."""
    results = []
    for rule in RULES:
        if series and rule.get("series", "").upper() != series.upper():
            continue
        results.append({
            "manufacturer": rule["manufacturer"],
            "product_line": rule["product_line"],
            "series": rule.get("series"),
            "confidence": rule["confidence"],
            "supported_contacts": rule.get("supported_contacts"),
        })
    return results


def tool_lookup_definition(category: str, code: str | None = None) -> dict:
    """Look up a MIL-DTL-38999 standard definition.
    Category can be: 'series', 'classes', 'contact_styles', 'shell_size_codes_series_iii_iv',
    'polarization', 'slash_sheets'.
    If code is provided, returns just that entry; otherwise returns the full category.
    """
    defs = _get_definitions()
    if category not in defs:
        return {
            "error": f"Unknown category '{category}'.",
            "available": list(defs.keys()),
        }
    category_data = defs[category]
    if code:
        if isinstance(category_data, dict) and code in category_data:
            return {category: {code: category_data[code]}}
        return {"error": f"Code '{code}' not found in '{category}'."}
    return {category: category_data}


# ---------------------------------------------------------------------------
# Tool schema (Ollama/OpenAI function-calling format)
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "decode_part_number",
            "description": (
                "Decode a MIL-DTL-38999 Series III or IV part number into its components "
                "(series, shell type, class, shell size, insert arrangement, contact style, key) "
                "and find matching manufacturer catalog part numbers."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "part_number": {
                        "type": "string",
                        "description": "The MIL-DTL-38999 part number, e.g. 'D38999/26WD35PN' or 'MS3470L22-55P'",
                    }
                },
                "required": ["part_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_insert_arrangement",
            "description": (
                "Look up details for a specific insert arrangement by its ID "
                "(shell_size-arrangement_number format, e.g. '22-55'). "
                "Returns contact count, service rating, and notes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "arrangement_id": {
                        "type": "string",
                        "description": "Insert arrangement ID, e.g. '22-55' or '20-9'",
                    }
                },
                "required": ["arrangement_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_dla_documents",
            "description": (
                "Search DLA procurement documents by slash sheet number, series, family, "
                "or keyword. Useful for finding official specs and QPL documents."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search term, e.g. '/26', 'Series III', 'Amphenol', 'hermetic'",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_manufacturers",
            "description": "List available manufacturer conversion rules, optionally filtered by series.",
            "parameters": {
                "type": "object",
                "properties": {
                    "series": {
                        "type": "string",
                        "description": "Filter by 'III' or 'IV'. Omit for all.",
                        "enum": ["III", "IV"],
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_definition",
            "description": (
                "Look up a MIL-DTL-38999 standard definition. "
                "Useful for decoding class codes, contact style codes, shell size codes, etc."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Definition category",
                        "enum": [
                            "series",
                            "classes",
                            "contact_styles",
                            "shell_size_codes_series_iii_iv",
                            "polarization",
                            "slash_sheets",
                        ],
                    },
                    "code": {
                        "type": "string",
                        "description": "Specific code to look up within the category, e.g. 'W' in classes. Omit to get the full category.",
                    },
                },
                "required": ["category"],
            },
        },
    },
]

TOOL_DISPATCH = {
    "decode_part_number": lambda args: tool_decode_part_number(**args),
    "lookup_insert_arrangement": lambda args: tool_lookup_insert_arrangement(**args),
    "search_dla_documents": lambda args: tool_search_dla_documents(**args),
    "list_manufacturers": lambda args: tool_list_manufacturers(**args),
    "lookup_definition": lambda args: tool_lookup_definition(**args),
}

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an expert on MIL-DTL-38999 circular electrical connectors.
You help engineers decode part numbers, identify insert arrangements, find manufacturer
equivalents, and navigate DLA procurement documents.

When a user gives you a part number, always call decode_part_number first.
When asked about contacts or insert arrangements, call lookup_insert_arrangement.
Be concise and precise. Cite the decoded fields when explaining a part number.
If a part number is invalid or unsupported, explain what is wrong and what is expected."""

# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------


def run_agent(model: str = "llama3.1") -> None:
    try:
        import ollama
    except ImportError:
        print("Error: 'ollama' package not installed. Run:  pip install ollama")
        sys.exit(1)

    # Verify Ollama server is reachable
    try:
        ollama.list()
    except Exception:
        print("Error: Ollama server is not running.")
        print("  Start it with:  ollama serve")
        print("  Or install from: https://ollama.com/download")
        sys.exit(1)

    # Check model is available
    available = [m.model.split(":")[0] for m in ollama.list().models]
    base_model = model.split(":")[0]
    if base_model not in available:
        print(f"Model '{model}' not found locally.")
        print(f"Pull it with:  ollama pull {model}")
        print(f"Available models: {', '.join(available) if available else '(none)'}")
        sys.exit(1)

    print(f"D38999 Agent  [model: {model}]")
    print("Type your question or a part number. Ctrl+C or 'quit' to exit.\n")

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    while True:
        try:
            user_input = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("Goodbye.")
            break

        messages.append({"role": "user", "content": user_input})

        # Agentic loop: keep calling until no more tool calls
        while True:
            response = ollama.chat(
                model=model,
                messages=messages,
                tools=TOOLS,
            )
            msg = response.message

            # Add assistant message to history
            messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": msg.tool_calls or []})

            if not msg.tool_calls:
                # Final text response
                print(f"\nAgent: {msg.content}\n")
                break

            # Execute tool calls
            for call in msg.tool_calls:
                name = call.function.name
                args = call.function.arguments or {}
                print(f"  [tool: {name}({', '.join(f'{k}={v!r}' for k,v in args.items())})]")

                if name in TOOL_DISPATCH:
                    result = TOOL_DISPATCH[name](args)
                else:
                    result = {"error": f"Unknown tool: {name}"}

                messages.append({
                    "role": "tool",
                    "content": json.dumps(result, indent=2),
                })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="D38999 AI agent powered by a local Ollama model."
    )
    parser.add_argument(
        "--model",
        default="llama3.1",
        help="Ollama model name (default: llama3.1). Try also: qwen2.5, mistral",
    )
    args = parser.parse_args()
    run_agent(model=args.model)


if __name__ == "__main__":
    main()
