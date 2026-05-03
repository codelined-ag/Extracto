"""
Run an Extracto OCR job through the OpenAI Python SDK.

Extracto exposes an OpenAI-shaped chat-completions adapter at
`/api/v1/openai/chat/completions`. Point the SDK's base_url at it,
pass an image as a `data:image/...` URL, and you get back a normal
ChatCompletion response with the OCR'd text in `choices[0].message.content`.

Setup:
    pip install openai
    export EXTRACTO_URL=http://localhost:3000
    export EXTRACTO_TOKEN=extr_...

Run:
    python python_openai_sdk.py path/to/page.png
"""
import base64
import os
import sys
from pathlib import Path

from openai import OpenAI


def to_data_url(path: Path) -> str:
    suffix = path.suffix.lstrip(".").lower() or "png"
    mime = "image/jpeg" if suffix in {"jpg", "jpeg"} else f"image/{suffix}"
    payload = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mime};base64,{payload}"


def main(file_path: str) -> None:
    client = OpenAI(
        api_key=os.environ["EXTRACTO_TOKEN"],
        base_url=f"{os.environ.get('EXTRACTO_URL', 'http://localhost:3000')}/api/v1/openai",
    )
    response = client.chat.completions.create(
        model=os.environ.get("OCR_MODEL", "anthropic/claude-haiku-4.5"),
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract every line of text in this image."},
                    {"type": "image_url", "image_url": {"url": to_data_url(Path(file_path))}},
                ],
            }
        ],
    )
    print(response.choices[0].message.content)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(f"usage: {sys.argv[0]} <image-path>")
    main(sys.argv[1])
