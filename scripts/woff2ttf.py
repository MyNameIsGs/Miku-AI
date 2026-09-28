"""WOFF 1.0 -> TTF/OTF con la librería estándar (zlib + struct).

Uso: python woff2ttf.py entrada.woff salida.ttf
"""
import struct
import sys
import zlib


def woff_to_sfnt(data: bytes) -> bytes:
    (signature, flavor, _length, num_tables, _reserved, _total_sfnt_size,
     _major, _minor, _meta_off, _meta_len, _meta_orig, _priv_off, _priv_len) = struct.unpack(
        ">4sIIHHIHHIIIII", data[:44])
    if signature != b"wOFF":
        raise ValueError("No es un archivo WOFF 1.0")

    tables = []
    for i in range(num_tables):
        tag, offset, comp_len, orig_len, checksum = struct.unpack(">4sIIII", data[44 + i * 20:64 + i * 20])
        raw = data[offset:offset + comp_len]
        table = zlib.decompress(raw) if comp_len < orig_len else raw
        if len(table) != orig_len:
            raise ValueError(f"Tabla {tag!r} con largo inesperado")
        tables.append((tag, checksum, table))

    tables.sort(key=lambda t: t[0])
    entry_selector = max(num_tables.bit_length() - 1, 0)
    search_range = (1 << entry_selector) * 16
    range_shift = num_tables * 16 - search_range

    header = struct.pack(">IHHHH", flavor, num_tables, search_range, entry_selector, range_shift)
    offset = 12 + 16 * num_tables
    records = b""
    body = b""
    for tag, checksum, table in tables:
        records += struct.pack(">4sIII", tag, checksum, offset + len(body), len(table))
        body += table + b"\0" * ((4 - len(table) % 4) % 4)
    return header + records + body


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, "rb") as f:
        out = woff_to_sfnt(f.read())
    with open(dst, "wb") as f:
        f.write(out)
    print(dst, len(out), "bytes")
