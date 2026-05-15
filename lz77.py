"""Реализация алгоритма LZ77.

Алгоритм использует скользящее окно, разделённое на буфер поиска
(search buffer) и буфер предпросмотра (lookahead buffer). На каждом шаге
ищется самое длинное совпадение префикса lookahead-буфера с любой подстрокой
search-буфера и выдаётся токен (offset, length, next_char).
"""

import math
import struct
from dataclasses import dataclass, asdict
from typing import List, Dict, Any


@dataclass
class Token:
    offset: int
    length: int
    next_char: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _find_longest_match(data: str, cursor: int, search_size: int, lookahead_size: int):
    """Ищет самое длинное совпадение в search-буфере.

    Возвращает (offset, length). offset отсчитывается назад от cursor.
    """
    end_of_buffer = min(cursor + lookahead_size, len(data))
    best_offset = 0
    best_length = 0

    start = max(0, cursor - search_size)
    # Перебираем все позиции в search-буфере как возможные начала совпадения
    for i in range(start, cursor):
        length = 0
        # Сравниваем символы; совпадение может «заезжать» в lookahead-буфер
        while (
            cursor + length < end_of_buffer
            and data[i + length] == data[cursor + length]
        ):
            length += 1
        if length > best_length:
            best_length = length
            best_offset = cursor - i

    return best_offset, best_length


def encode(data: str, search_size: int = 32, lookahead_size: int = 16):
    """Кодирует строку алгоритмом LZ77.

    Возвращает словарь с токенами и пошаговой трассировкой для визуализации.
    """
    tokens: List[Token] = []
    steps: List[Dict[str, Any]] = []
    cursor = 0
    n = len(data)

    while cursor < n:
        offset, length = _find_longest_match(data, cursor, search_size, lookahead_size)

        # next_char — символ сразу после совпадения
        if cursor + length < n:
            next_char = data[cursor + length]
        else:
            next_char = ""

        token = Token(offset=offset, length=length, next_char=next_char)
        tokens.append(token)

        search_start = max(0, cursor - search_size)
        step = {
            "step_index": len(steps),
            "cursor": cursor,
            "search_buffer": data[search_start:cursor],
            "search_buffer_start": search_start,
            "lookahead_buffer": data[cursor : cursor + lookahead_size],
            "match_offset": offset,
            "match_length": length,
            "matched_text": data[cursor : cursor + length],
            "next_char": next_char,
            "token": token.to_dict(),
            "tokens_so_far": len(tokens),
        }
        steps.append(step)

        # Сдвигаем курсор на длину совпадения + 1 (за next_char)
        cursor += length + (1 if next_char else 0)

    # Оценка размера, согласованная с реальной упаковкой pack():
    # offset_bits + length_bits + 1 бит has_next + 8 бит next_char (если есть),
    # плюс 12 байт заголовка файла.
    offset_bits = _bits_for(search_size)
    length_bits = _bits_for(lookahead_size)
    token_bits_no_next = offset_bits + length_bits + 1
    token_bits_with_next = token_bits_no_next + 8
    total_token_bits = sum(
        token_bits_with_next if t.next_char else token_bits_no_next
        for t in tokens
    )
    header_bytes = len(MAGIC) + struct.calcsize(">HHI")
    compressed_bytes = header_bytes + (total_token_bits + 7) // 8
    compressed_bits = compressed_bytes * 8
    original_bits = len(data.encode("utf-8")) * 8
    ratio = compressed_bytes * 8 / original_bits if original_bits else 0
    avg_token_bits = token_bits_with_next  # для отображения

    return {
        "tokens": [t.to_dict() for t in tokens],
        "steps": steps,
        "stats": {
            "original_size_bytes": len(data.encode("utf-8")),
            "original_size_bits": original_bits,
            "token_count": len(tokens),
            "token_bits": avg_token_bits,
            "offset_bits": offset_bits,
            "length_bits": length_bits,
            "compressed_size_bits": compressed_bits,
            "compressed_size_bytes": compressed_bytes,
            "compression_ratio": ratio,
            "space_saving": 1 - ratio if ratio else 0,
        },
        "params": {
            "search_size": search_size,
            "lookahead_size": lookahead_size,
        },
    }


def decode(tokens: List[Dict[str, Any]]) -> str:
    """Восстанавливает исходную строку из списка токенов LZ77."""
    out = []
    for tok in tokens:
        offset = tok["offset"]
        length = tok["length"]
        next_char = tok.get("next_char", "")

        if length > 0:
            start = len(out) - offset
            # Копируем посимвольно — это важно: совпадение может «перекрывать» сам себя
            # (так кодируются повторы вроде "aaaaaa").
            for i in range(length):
                out.append(out[start + i])
        if next_char:
            out.append(next_char)
    return "".join(out)


# --------------------------------------------------------------------------
# Бинарная упаковка токенов для сжатия файлов (с побитной упаковкой)
# --------------------------------------------------------------------------
#
# Формат файла .lz77:
#   magic         : 4 байта  = b"LZ77"
#   search_size   : 2 байта  (uint16 BE)
#   lookahead     : 2 байта  (uint16 BE)
#   token_count   : 4 байта  (uint32 BE)
#   bit_stream    : плотно упакованный поток токенов:
#                   offset    (offset_bits   = ceil(log2(search_size+1)) бит)
#                   length    (length_bits   = ceil(log2(lookahead_size+1)) бит)
#                   has_next  (1 бит)
#                   next      (8 бит, только если has_next == 1)

MAGIC = b"LZ77"


def encode_bytes(data: bytes, search_size: int = 4096, lookahead_size: int = 64):
    """Сжимает произвольную последовательность байт.

    Использует latin-1 как 1:1 отображение byte<->char и переиспользует
    основной алгоритм encode().
    """
    s = data.decode("latin-1")
    return encode(s, search_size=search_size, lookahead_size=lookahead_size)


def decode_bytes(tokens: List[Dict[str, Any]]) -> bytes:
    """Восстанавливает байты из токенов LZ77."""
    return decode(tokens).encode("latin-1")


class _BitWriter:
    """Накапливает биты MSB-first и отдаёт байтовую строку."""

    def __init__(self):
        self._buf = bytearray()
        self._cur = 0  # текущий незаконченный байт
        self._used = 0  # сколько бит занято в _cur

    def write(self, value: int, nbits: int) -> None:
        for i in range(nbits - 1, -1, -1):
            bit = (value >> i) & 1
            self._cur = (self._cur << 1) | bit
            self._used += 1
            if self._used == 8:
                self._buf.append(self._cur)
                self._cur = 0
                self._used = 0

    def getvalue(self) -> bytes:
        if self._used > 0:
            # дописываем нулями до байта
            self._buf.append(self._cur << (8 - self._used))
        return bytes(self._buf)


class _BitReader:
    """Читает биты MSB-first из байтовой строки."""

    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0  # текущая позиция в битах

    def read(self, nbits: int) -> int:
        value = 0
        for _ in range(nbits):
            byte_idx = self._pos >> 3
            bit_idx = 7 - (self._pos & 7)
            bit = (self._data[byte_idx] >> bit_idx) & 1
            value = (value << 1) | bit
            self._pos += 1
        return value


def _bits_for(max_value: int) -> int:
    """Сколько бит нужно, чтобы закодировать целое в [0, max_value]."""
    if max_value <= 0:
        return 1
    return max(1, math.ceil(math.log2(max_value + 1)))


def pack(result: Dict[str, Any]) -> bytes:
    """Сериализует результат encode() в бинарный формат .lz77 (бит-паковка)."""
    tokens = result["tokens"]
    params = result["params"]
    search_size = params["search_size"]
    lookahead_size = params["lookahead_size"]
    offset_bits = _bits_for(search_size)
    length_bits = _bits_for(lookahead_size)

    bw = _BitWriter()
    for t in tokens:
        bw.write(t["offset"], offset_bits)
        bw.write(t["length"], length_bits)
        nc = t["next_char"]
        if nc:
            bw.write(1, 1)
            bw.write(ord(nc) & 0xFF, 8)
        else:
            bw.write(0, 1)

    header = MAGIC + struct.pack(">HHI", search_size, lookahead_size, len(tokens))
    return header + bw.getvalue()


def unpack(blob: bytes) -> List[Dict[str, Any]]:
    """Десериализует бинарный поток .lz77 в список токенов."""
    if len(blob) < 12 or not blob.startswith(MAGIC):
        raise ValueError("Файл не является .lz77 (неверный заголовок)")
    search_size, lookahead_size, count = struct.unpack(">HHI", blob[4:12])
    offset_bits = _bits_for(search_size)
    length_bits = _bits_for(lookahead_size)
    body = blob[12:]

    # Проверяем, что битового потока хватит на заявленные токены
    min_bits = count * (offset_bits + length_bits + 1)
    if len(body) * 8 < min_bits:
        raise ValueError("Файл .lz77 повреждён или обрезан")

    br = _BitReader(body)
    tokens: List[Dict[str, Any]] = []
    try:
        for _ in range(count):
            offset = br.read(offset_bits)
            length = br.read(length_bits)
            has_next = br.read(1)
            nc = chr(br.read(8)) if has_next else ""
            tokens.append({"offset": offset, "length": length, "next_char": nc})
    except IndexError:
        raise ValueError("Файл .lz77 повреждён или обрезан")
    return tokens


if __name__ == "__main__":
    sample = "abracadabra abracadabra abracadabra"
    result = encode(sample)
    restored = decode(result["tokens"])
    assert restored == sample, (restored, sample)
    print(f"OK: {len(result['tokens'])} tokens, ratio={result['stats']['compression_ratio']:.3f}")
