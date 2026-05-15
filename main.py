"""FastAPI-сервер для демонстрации работы алгоритма LZ77."""

from pathlib import Path
from typing import List, Dict, Any
from urllib.parse import quote

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from lz77 import encode, decode, encode_bytes, decode_bytes, pack, unpack


def _content_disposition(filename: str) -> str:
    """Заголовок Content-Disposition с поддержкой не-ASCII имён (RFC 5987).

    HTTP-заголовки должны кодироваться как latin-1, поэтому имена файлов с
    кириллицей или другими символами вне ASCII передаются через filename*.
    """
    ascii_name = filename.encode("ascii", "replace").decode("ascii").replace("?", "_")
    quoted = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quoted}"


app = FastAPI(title="LZ77 Demo", description="Демонстрация алгоритма LZ77")

STATIC_DIR = Path(__file__).parent / "static"


class EncodeRequest(BaseModel):
    text: str = Field(..., description="Исходный текст")
    search_size: int = Field(32, ge=2, le=4096)
    lookahead_size: int = Field(16, ge=2, le=1024)


class DecodeRequest(BaseModel):
    tokens: List[Dict[str, Any]]


@app.post("/api/encode")
def api_encode(req: EncodeRequest):
    return encode(req.text, req.search_size, req.lookahead_size)


@app.post("/api/decode")
def api_decode(req: DecodeRequest):
    return {"text": decode(req.tokens)}


@app.post("/api/compress-file")
async def api_compress_file(
    file: UploadFile = File(...),
    search_size: int = Form(4096),
    lookahead_size: int = Form(64),
):
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Файл больше 5 МБ")
    result = encode_bytes(data, search_size=search_size, lookahead_size=lookahead_size)
    blob = pack(result)
    out_name = (file.filename or "input") + ".lz77"
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": _content_disposition(out_name),
            "X-Original-Size": str(len(data)),
            "X-Compressed-Size": str(len(blob)),
            "X-Token-Count": str(len(result["tokens"])),
            "Access-Control-Expose-Headers": "X-Original-Size, X-Compressed-Size, X-Token-Count",
        },
    )


@app.post("/api/decompress-file")
async def api_decompress_file(file: UploadFile = File(...)):
    blob = await file.read()
    try:
        tokens = unpack(blob)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    data = decode_bytes(tokens)
    out_name = (file.filename or "output.lz77").removesuffix(".lz77") or "decompressed.bin"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": _content_disposition(out_name),
            "X-Decompressed-Size": str(len(data)),
            "Access-Control-Expose-Headers": "X-Decompressed-Size",
        },
    )


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
